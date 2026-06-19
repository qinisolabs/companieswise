import { getRecord, searchRecords, datasetInfo } from "./data.js";
export { datasetInfo } from "./data.js";

// UK company numbers are 8 characters: either 8 digits (England & Wales) or a
// 2-letter prefix + 6 digits. There is NO check digit, so validation is format +
// known-prefix recognition only.
const FORMAT = /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/;

// Common Companies House number prefixes → what they denote.
const PREFIXES: Record<string, string> = {
  OC: "Limited Liability Partnership (England & Wales)",
  LP: "Limited Partnership (England & Wales)",
  SC: "Company registered in Scotland",
  SO: "Limited Liability Partnership (Scotland)",
  SL: "Limited Partnership (Scotland)",
  NI: "Company registered in Northern Ireland",
  NC: "Limited Liability Partnership (Northern Ireland)",
  NL: "Limited Partnership (Northern Ireland)",
  AC: "Assurance company (England & Wales)",
  SA: "Assurance company (Scotland)",
  FC: "Overseas company",
  BR: "UK establishment of an overseas company",
  GE: "European Economic Interest Grouping (England & Wales)",
  GS: "European Economic Interest Grouping (Scotland)",
  SE: "European Company (Societas Europaea)",
  IP: "Registered Society / Industrial & Provident (England & Wales)",
  SP: "Registered Society (Scotland)",
  NP: "Registered Society (Northern Ireland)",
  IC: "Investment Company with Variable Capital (England & Wales)",
  SI: "Investment Company with Variable Capital (Scotland)",
  RC: "Royal Charter company (England & Wales)",
  SR: "Royal Charter company (Scotland)",
  NR: "Royal Charter company (Northern Ireland)",
  CE: "Charitable Incorporated Organisation (England & Wales)",
  CS: "Charitable Incorporated Organisation (Scotland)",
  ZC: "Unregistered / other company (England & Wales)",
  PC: "Protected Cell Company",
};

const ATTRIBUTION =
  "Contains public sector information from Companies House licensed under the Open Government Licence v3.0.";
const BASIS =
  "Companies House monthly snapshot of the live register — status and details are as of the dataset date, NOT real-time. Dissolved companies are generally not in the free snapshot.";

/** Normalise a company number to its canonical 8-character form (uppercase, zero-padded). */
export function normalizeNumber(input: string): string {
  let s = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]{2})([0-9]{1,6})$/);
  if (m) return m[1] + m[2].padStart(6, "0");
  if (/^[0-9]{1,8}$/.test(s)) return s.padStart(8, "0");
  return s;
}

export interface CompanyNumberResult {
  input: string;
  number: string | null;
  valid: boolean;
  prefix: string | null;
  meaning: string | null;
  errors: string[];
}

/** Validate a UK company number's FORMAT (no check digit exists) and identify its prefix. */
export function validateCompanyNumber(input: string): CompanyNumberResult {
  const number = normalizeNumber(input);
  const base: CompanyNumberResult = { input, number: null, valid: false, prefix: null, meaning: null, errors: [] };
  if (!FORMAT.test(number)) {
    return { ...base, errors: ["Not a well-formed UK company number (8 digits, or a 2-letter prefix + 6 digits)."] };
  }
  const prefix = /^[A-Z]{2}/.test(number) ? number.slice(0, 2) : null;
  return {
    ...base,
    number,
    valid: true,
    prefix,
    meaning: prefix
      ? PREFIXES[prefix] ??
        `Structurally valid, but '${prefix}' is not a recognised Companies House register prefix here — confirm the company with lookup_company`
      : "England & Wales company (8 digits)",
  };
}

export interface CompanyLookupResult {
  input: string;
  number: string | null;
  wellFormed: boolean;
  found: boolean;
  name: string | null;
  status: string | null;
  companyType: string | null;
  incorporationDate: string | null;
  postcode: string | null;
  sic: string | null;
  coverage: "United Kingdom";
  basis: string;
  dataset: "sample" | "snapshot";
  datasetVersion: string;
  attribution: string;
  note?: string;
  errors: string[];
}

/**
 * Look up a UK company by its number in the Companies House snapshot. Returns the
 * official registered details, or an honest "not found" instead of guessing.
 */
export function lookupCompany(input: string): CompanyLookupResult {
  const info = datasetInfo();
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
    basis: BASIS,
    dataset: info.kind,
    datasetVersion: info.version,
    attribution: ATTRIBUTION,
    errors: [],
  };
  if (!FORMAT.test(number)) {
    base.errors.push("Not a well-formed UK company number (8 digits, or a 2-letter prefix + 6 digits).");
    return base;
  }
  base.wellFormed = true;
  base.number = number;

  const rec = getRecord(number);
  if (rec) {
    base.found = true;
    base.name = rec.name;
    base.status = rec.status;
    base.companyType = rec.category;
    base.incorporationDate = rec.incorporationDate;
    base.postcode = rec.postcode;
    base.sic = rec.sic;
    if (info.kind === "sample") {
      base.note =
        "Running on the ILLUSTRATIVE sample, not the real Companies House data — run `npx companieswise-update` (or let the monthly CI build) to load the real snapshot.";
    }
  } else {
    base.note =
      info.kind === "sample"
        ? "Well-formed number, but only the illustrative sample is loaded. Run `npx companieswise-update` to fetch the real Companies House snapshot."
        : "Well-formed number, but not in the loaded live-register snapshot. It may be a dissolved company (not in the free snapshot), a number not yet issued, or one registered/changed since the dataset date — check the live Companies House register for current status. Not guessing.";
  }
  return base;
}

export interface CompanySearchHit {
  number: string;
  name: string;
  status: string;
}
export interface CompanySearchResult {
  query: string;
  count: number;
  results: CompanySearchHit[];
  dataset: "sample" | "snapshot";
  datasetVersion: string;
  truncated: boolean;
  note?: string;
}

/** Find companies whose name contains ALL of the query's words (case-insensitive). */
export function searchCompany(query: string, limit = 20): CompanySearchResult {
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  const info = datasetInfo();
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const recs = searchRecords(words, limit);
  const truncated = recs.length > limit;
  const hits: CompanySearchHit[] = recs
    .slice(0, limit)
    .map((r) => ({ number: r.number, name: r.name, status: r.status }));
  return {
    query,
    count: hits.length,
    results: hits,
    dataset: info.kind,
    datasetVersion: info.version,
    truncated,
    note:
      info.kind === "sample"
        ? "Searching the illustrative sample only — run `npx companieswise-update` for the real snapshot."
        : undefined,
  };
}
