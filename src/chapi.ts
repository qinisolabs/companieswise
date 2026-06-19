// Optional LIVE mode: when a Companies House API key is provided, companieswise queries the
// official Companies House Public Data API instead of the bundled monthly snapshot, so results
// are real-time and include dissolved companies. BYO-key — the user supplies their own free key
// (https://developer.company-information.service.gov.uk/), so there is no shared rate limit and
// nothing is hosted. With no key set, the tool transparently falls back to the snapshot.
//
// The live functions return the SAME result shapes as the snapshot functions (tagged
// dataset: "live"), so every caller — MCP tool, library, future hosted endpoint — is unchanged.
import { normalizeNumber, type CompanyLookupResult, type CompanySearchResult, type CompanySearchHit } from "./company.js";

const API_BASE = "https://api.company-information.service.gov.uk";
// Companies House's API gateway rejects requests with a default/programmatic User-Agent
// (e.g. Node's "node"), so we send an explicit, identifiable one.
const USER_AGENT = "companieswise (+https://github.com/qinisolabs/companieswise)";
const ATTRIBUTION =
  "Contains public sector information from Companies House licensed under the Open Government Licence v3.0.";
const LIVE_BASIS =
  "Live query of the official Companies House Public Data API — real-time register status, including dissolved companies.";

/** The Companies House API key, if the user has supplied one (enables live mode). */
export function chApiKey(): string | undefined {
  const k = (process.env.COMPANIESWISE_CH_API_KEY || process.env.CH_API_KEY || "").trim();
  return k.length > 0 ? k : undefined;
}

function authHeader(key: string): string {
  // CH uses HTTP Basic auth with the API key as the username and an empty password.
  const b64 = typeof btoa === "function" ? btoa(`${key}:`) : Buffer.from(`${key}:`).toString("base64");
  return `Basic ${b64}`;
}

/** Map a CH `company_status` slug (e.g. "voluntary-arrangement") to a readable label. */
function statusLabel(s: string | undefined): string | null {
  if (!s) return null;
  return s
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const TYPE_LABELS: Record<string, string> = {
  ltd: "Private Limited Company",
  plc: "Public Limited Company",
  llp: "Limited Liability Partnership",
  "limited-partnership": "Limited Partnership",
  "private-unlimited": "Private Unlimited Company",
  "private-unlimited-nsc": "Private Unlimited Company (no share capital)",
  "old-public-company": "Old Public Company",
  "private-limited-guarant-nsc": "Private Limited by Guarantee (no share capital)",
  "private-limited-guarant-nsc-limited-exemption": "Private Limited by Guarantee (no share capital, exempt)",
  "community-interest-company": "Community Interest Company",
  "charitable-incorporated-organisation": "Charitable Incorporated Organisation",
  "scottish-charitable-incorporated-organisation": "Scottish Charitable Incorporated Organisation",
  "scottish-partnership": "Scottish Partnership",
  "royal-charter": "Royal Charter Company",
  "industrial-and-provident-society": "Registered Society (Industrial & Provident)",
  "registered-overseas-entity": "Registered Overseas Entity",
  "uk-establishment": "UK Establishment of an Overseas Company",
  "investment-company-with-variable-capital": "Investment Company with Variable Capital",
  eeig: "European Economic Interest Grouping",
};
function typeLabel(t: string | undefined): string | null {
  if (!t) return null;
  if (TYPE_LABELS[t]) return TYPE_LABELS[t];
  return t
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

async function chGet(path: string, key: string): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: authHeader(key), Accept: "application/json", "User-Agent": USER_AGENT },
    });
  } catch (e: any) {
    const err: any = new Error(`Could not reach the Companies House API: ${e?.message ?? e}`);
    err.code = -32603;
    throw err;
  }
  if (res.status === 401) {
    const err: any = new Error("Companies House API rejected the key (401). Check COMPANIESWISE_CH_API_KEY.");
    err.code = -32602;
    throw err;
  }
  if (res.status === 429) {
    const err: any = new Error("Companies House API rate limit hit (429) — 600 requests / 5 min per key. Retry shortly.");
    err.code = -32603;
    throw err;
  }
  let body: any = null;
  if (res.status !== 404) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }
  if (res.status >= 400 && res.status !== 404) {
    const detail = body && (body.error || body.errors) ? ` — ${JSON.stringify(body.error ?? body.errors)}` : "";
    const err: any = new Error(`Companies House API error ${res.status}${detail}.`);
    err.code = -32603;
    throw err;
  }
  return { status: res.status, body };
}

/** Live company lookup by number via the Companies House API (real-time, includes dissolved). */
export async function lookupCompanyLive(input: string, key: string): Promise<CompanyLookupResult> {
  const number = normalizeNumber(input);
  const base: CompanyLookupResult = {
    input,
    number: null,
    wellFormed: false,
    found: false,
    name: null,
    status: null,
    companyType: null,
    incorporationDate: null,
    postcode: null,
    sic: null,
    coverage: "United Kingdom",
    basis: LIVE_BASIS,
    dataset: "live",
    datasetVersion: "live",
    attribution: ATTRIBUTION,
    errors: [],
  };
  if (!/^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(number)) {
    base.errors.push("Not a well-formed UK company number (8 digits, or a 2-letter prefix + 6 digits).");
    return base;
  }
  base.wellFormed = true;
  base.number = number;

  const { status, body } = await chGet(`/company/${encodeURIComponent(number)}`, key);
  if (status === 404 || !body) {
    base.note = "Not found on the live Companies House register — the number may never have been issued. Not guessing.";
    return base;
  }
  base.found = true;
  base.name = body.company_name ?? null;
  base.status = statusLabel(body.company_status);
  base.companyType = typeLabel(body.type);
  base.incorporationDate = body.date_of_creation ?? null;
  base.postcode = body.registered_office_address?.postal_code ?? null;
  base.sic = Array.isArray(body.sic_codes) && body.sic_codes.length ? body.sic_codes.join(", ") : null;
  return base;
}

/** Live company name search via the Companies House API (real-time, includes dissolved). */
export async function searchCompanyLive(query: string, limit: number, key: string): Promise<CompanySearchResult> {
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 100);
  const q = (query ?? "").trim();
  const { body } = await chGet(
    `/search/companies?q=${encodeURIComponent(q)}&items_per_page=${limit}`,
    key,
  );
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  const hits: CompanySearchHit[] = items.map((it) => ({
    number: it.company_number ?? "",
    name: it.title ?? "",
    status: statusLabel(it.company_status) ?? "",
  }));
  const total = typeof body?.total_results === "number" ? body.total_results : hits.length;
  return {
    query,
    count: hits.length,
    totalMatches: total,
    results: hits,
    dataset: "live",
    datasetVersion: "live",
    truncated: total > hits.length,
  };
}
