// Dataset loading. The package BUNDLES only a small illustrative sample. The real
// Companies House monthly snapshot (~5.6M companies) is far too big for npm, so it is
// downloaded once (by `companieswise-update`, or the monthly CI build) into a local
// cache file and loaded from there. Resolution order:
//   1. $COMPANIESWISE_DATA_FILE  (explicit path; .gz supported)  — used by tests/CI
//   2. the default cache file     (populated by companieswise-update)
//   3. the bundled sample         (dataset: "sample")
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DATA } from "./data.generated.js";

export interface CompanyRecord {
  number: string;
  name: string;
  status: string;
  category: string;
  incorporationDate: string;
  postcode: string;
  sic: string;
}

export type DatasetKind = "sample" | "snapshot";

export interface Dataset {
  map: Map<string, CompanyRecord>;
  version: string;
  kind: DatasetKind;
}

/** Default on-disk cache location for the downloaded snapshot. */
export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir() || tmpdir(), ".cache");
  return join(base, "companieswise");
}
export function cacheFile(): string {
  return join(cacheDir(), "companies.tsv.gz");
}

function parsePacked(text: string): { version: string; map: Map<string, CompanyRecord> } {
  const map = new Map<string, CompanyRecord>();
  let version = "unknown";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("##")) {
      const m = line.match(/VERSION=(.*)$/);
      if (m) version = m[1].trim();
      continue;
    }
    const c = line.split("\t");
    const number = (c[0] || "").toUpperCase().trim();
    if (!number) continue;
    map.set(number, {
      number,
      name: c[1] || "",
      status: c[2] || "",
      category: c[3] || "",
      incorporationDate: c[4] || "",
      postcode: c[5] || "",
      sic: c[6] || "",
    });
  }
  return { version, map };
}

function readMaybeGzip(path: string): string {
  const buf = readFileSync(path);
  // gzip magic bytes 0x1f 0x8b
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString("utf8");
  return buf.toString("utf8");
}

let cached: Dataset | null = null;

// Try to load a snapshot file; return null (so we fall back to the sample) if it is
// missing, unreadable, a corrupt gzip, or parsed to zero companies — never serve an
// empty snapshot, which would make the tool say "not found" for real companies.
function tryLoadSnapshot(path: string): Dataset | null {
  try {
    if (!existsSync(path)) return null;
    const text = readMaybeGzip(path);
    if (!text.startsWith("##VERSION=")) {
      console.error(`companieswise: ${path} is not a valid data artifact (no ##VERSION header) — using the sample.`);
      return null;
    }
    const { version, map } = parsePacked(text);
    if (map.size === 0) {
      console.error(`companieswise: ${path} loaded 0 companies — ignoring it and using the sample.`);
      return null;
    }
    return { map, version, kind: "snapshot" };
  } catch (err) {
    console.error(`companieswise: failed to load ${path} (${(err as Error).message}) — using the sample.`);
    return null;
  }
}

/** Load the dataset once (lazily): explicit file → cache file → bundled sample. */
export function getDataset(): Dataset {
  if (cached) return cached;
  const explicit = process.env.COMPANIESWISE_DATA_FILE;
  cached =
    (explicit ? tryLoadSnapshot(explicit) : null) ??
    tryLoadSnapshot(cacheFile()) ??
    { ...parsePacked(SAMPLE_DATA), kind: "sample" as const };
  return cached;
}

/** Reset the in-memory cache (used by tests after changing the env/file). */
export function resetDataset(): void {
  cached = null;
}

export const DATA_URL_DEFAULT =
  process.env.COMPANIESWISE_DATA_URL ||
  "https://github.com/qinisolabs/companieswise/releases/download/data/companies.tsv.gz";

/**
 * Download the latest snapshot artifact to the local cache. Used by the
 * `companieswise-update` bin. Stores gzipped; re-gzips if the source isn't already.
 */
export async function downloadAndCache(url: string = DATA_URL_DEFAULT): Promise<{ path: string; bytes: number }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  const raw = Buffer.from(await res.arrayBuffer());
  const isGz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  // Validate it's actually a companieswise artifact before caching — guards against a
  // login/redirect HTML page or an error body being saved and silently breaking lookups.
  const text = isGz ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  if (!text.startsWith("##VERSION=")) {
    throw new Error(`Downloaded content is not a companieswise data artifact (missing ##VERSION header) — refusing to cache. URL: ${url}`);
  }
  const out = isGz ? raw : gzipSync(raw);
  mkdirSync(cacheDir(), { recursive: true });
  const path = cacheFile();
  // Write atomically: a crash mid-write must not leave a corrupt cache.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, path);
  resetDataset();
  return { path, bytes: out.length };
}
