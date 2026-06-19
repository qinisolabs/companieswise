// Dataset loading. The package BUNDLES only a small illustrative sample. The real
// Companies House monthly snapshot (~5.6M companies) is downloaded once (by
// `companieswise-update`, or the monthly CI build) into a local cache file.
//
// The decompressed snapshot is >512MB of text — larger than V8's max string length —
// so we never hold it as one string. We keep the decompressed BUFFER (off-heap) and an
// in-memory index of company number -> byte offset of its row; a lookup slices just that
// row on demand. This keeps the V8 heap small and avoids the string-length limit.
//
// Resolution order: $COMPANIESWISE_DATA_FILE -> cache file -> bundled sample.
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

const NL = 0x0a; // "\n"
const TAB = 0x09; // "\t"
const HEADER = "##VERSION=";

interface Loaded {
  buf: Buffer;
  index: Map<string, number>; // company number -> byte offset of the row start
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

function decompress(path: string): Buffer {
  const buf = readFileSync(path);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf);
  return buf;
}

// Build the number->offset index by scanning the buffer for newlines/tabs — no giant string.
function buildIndex(buf: Buffer): { index: Map<string, number>; version: string } {
  const index = new Map<string, number>();
  let version = "unknown";
  const len = buf.length;
  let lineStart = 0;
  for (let i = 0; i <= len; i++) {
    if (i === len || buf[i] === NL) {
      if (i > lineStart) {
        if (buf[lineStart] === 0x23 /* '#' */ && buf[lineStart + 1] === 0x23) {
          const m = buf.toString("utf8", lineStart, i).match(/VERSION=(.*)$/);
          if (m) version = m[1].trim();
        } else {
          let t = lineStart;
          while (t < i && buf[t] !== TAB) t++;
          if (t > lineStart) index.set(buf.toString("utf8", lineStart, t).toUpperCase(), lineStart);
        }
      }
      lineStart = i + 1;
    }
  }
  return { index, version };
}

function rowAt(buf: Buffer, off: number): string[] {
  let end = buf.indexOf(NL, off);
  if (end === -1) end = buf.length;
  return buf.toString("utf8", off, end).split("\t");
}
function toRecord(cells: string[]): CompanyRecord {
  return {
    number: cells[0] || "",
    name: cells[1] || "",
    status: cells[2] || "",
    category: cells[3] || "",
    incorporationDate: cells[4] || "",
    postcode: cells[5] || "",
    sic: cells[6] || "",
  };
}

// Try to load a snapshot buffer; return null (→ fall back to sample) if missing,
// unreadable, headerless, a corrupt gzip, or indexed to zero companies — never serve
// empty data, which would make the tool say "not found" for real companies.
function tryLoad(path: string | undefined, kind: DatasetKind): Loaded | null {
  try {
    if (!path || !existsSync(path)) return null;
    const buf = decompress(path);
    if (buf.length < HEADER.length || buf.toString("utf8", 0, HEADER.length) !== HEADER) {
      console.error(`companieswise: ${path} is not a valid data artifact (no ${HEADER} header) — using the sample.`);
      return null;
    }
    const { index, version } = buildIndex(buf);
    if (index.size === 0) {
      console.error(`companieswise: ${path} indexed 0 companies — ignoring it and using the sample.`);
      return null;
    }
    return { buf, index, version, kind };
  } catch (err) {
    console.error(`companieswise: failed to load ${path} (${(err as Error).message}) — using the sample.`);
    return null;
  }
}

let loaded: Loaded | null = null;

function ensureLoaded(): Loaded {
  if (loaded) return loaded;
  const explicit = process.env.COMPANIESWISE_DATA_FILE;
  loaded = tryLoad(explicit, "snapshot") ?? tryLoad(cacheFile(), "snapshot");
  if (!loaded) {
    const buf = Buffer.from(SAMPLE_DATA, "utf8");
    const { index, version } = buildIndex(buf);
    loaded = { buf, index, version, kind: "sample" };
  }
  return loaded;
}

/** Reset the in-memory dataset (used by tests after changing the env/file). */
export function resetDataset(): void {
  loaded = null;
}

/** Dataset metadata: kind (sample|snapshot), version (snapshot date), size (companies). */
export function datasetInfo(): { kind: DatasetKind; version: string; size: number } {
  const ds = ensureLoaded();
  return { kind: ds.kind, version: ds.version, size: ds.index.size };
}

/** Look up a single company's record by its (already-normalised) number, or undefined. */
export function getRecord(number: string): CompanyRecord | undefined {
  const ds = ensureLoaded();
  const off = ds.index.get(number);
  if (off === undefined) return undefined;
  return toRecord(rowAt(ds.buf, off));
}

// Extract just the name (2nd field) without splitting the whole row — keeps the
// full-dataset scan cheap (no 7-field split + record build per non-candidate row).
function nameAt(buf: Buffer, off: number): string {
  const t1 = buf.indexOf(TAB, off);
  if (t1 === -1) return "";
  let t2 = buf.indexOf(TAB, t1 + 1);
  if (t2 === -1) {
    const nl = buf.indexOf(NL, t1 + 1);
    t2 = nl === -1 ? buf.length : nl;
  }
  return buf.toString("utf8", t1 + 1, t2);
}

// Relevance: exact name (4) > prefix at a word boundary (3) > whole-word match (2) > substring (1).
function scoreName(nameLower: string, q: string): number {
  if (!q) return 1;
  if (nameLower === q) return 4;
  if (nameLower.startsWith(q) && (nameLower.length === q.length || /[^a-z0-9]/.test(nameLower[q.length]))) return 3;
  const i = nameLower.indexOf(q);
  if (i >= 0) {
    const before = i === 0 || /[^a-z0-9]/.test(nameLower[i - 1]);
    const after = i + q.length === nameLower.length || /[^a-z0-9]/.test(nameLower[i + q.length]);
    if (before && after) return 2;
  }
  return 1;
}

export interface SearchOutcome {
  hits: CompanyRecord[];
  total: number;
}

/**
 * Find companies whose name contains ALL the given words, ranked by relevance
 * (exact > prefix > whole-word > substring; then shorter name, then alphabetical).
 * Returns the top `limit` and the total number of matches.
 */
export function searchRecords(words: string[], limit: number, q: string): SearchOutcome {
  const ds = ensureLoaded();
  if (!words.length) return { hits: [], total: 0 };
  let total = 0;
  type Cand = { score: number; len: number; nl: string; off: number };
  const cmp = (a: Cand, b: Cand) => b.score - a.score || a.len - b.len || (a.nl < b.nl ? -1 : a.nl > b.nl ? 1 : 0);
  const best: Cand[] = []; // kept sorted best-first, length <= limit
  for (const off of ds.index.values()) {
    const name = nameAt(ds.buf, off);
    const nl = name.toLowerCase();
    if (!words.every((w) => nl.includes(w))) continue;
    total++;
    const cand: Cand = { score: scoreName(nl, q), len: name.length, nl, off };
    if (best.length >= limit && cmp(cand, best[best.length - 1]) >= 0) continue;
    best.push(cand);
    best.sort(cmp);
    if (best.length > limit) best.pop();
  }
  return { hits: best.map((b) => toRecord(rowAt(ds.buf, b.off))), total };
}

export const DATA_URL_DEFAULT =
  process.env.COMPANIESWISE_DATA_URL ||
  "https://github.com/qinisolabs/companieswise/releases/download/data/companies.tsv.gz";

/**
 * Download the latest snapshot artifact to the local cache. Used by `companieswise-update`.
 * Validates it's actually a companieswise artifact, stores gzipped, writes atomically.
 */
export async function downloadAndCache(url: string = DATA_URL_DEFAULT): Promise<{ path: string; bytes: number }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  const raw = Buffer.from(await res.arrayBuffer());
  const isGz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  // Validate the header. toString(0, HEADER.length) only converts a few bytes, so this is
  // cheap even though the decompressed buffer is large.
  const head = (isGz ? gunzipSync(raw) : raw).toString("utf8", 0, HEADER.length);
  if (head !== HEADER) {
    throw new Error(`Downloaded content is not a companieswise data artifact (missing ${HEADER} header) — refusing to cache. URL: ${url}`);
  }
  const out = isGz ? raw : gzipSync(raw);
  mkdirSync(cacheDir(), { recursive: true });
  const path = cacheFile();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, path);
  resetDataset();
  return { path, bytes: out.length };
}
