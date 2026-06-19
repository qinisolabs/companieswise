// Build the compact snapshot artifact (data/companies.tsv.gz) from the official
// Companies House "Free Company Data Product" CSV.
//
// The monthly CI workflow downloads BasicCompanyDataAsOneFile-YYYY-MM-01.zip, unzips it,
// and runs this on the resulting CSV. It streams the (multi-GB) file line by line, keeps
// the KYC-relevant columns, and writes a gzipped tab-separated artifact with a
// "##VERSION=<date>" header line. That artifact is published as a GitHub Release asset and
// fetched by `companieswise-update`.
//
// Usage:
//   node scripts/build-data.mjs <BasicCompanyData...csv> <version e.g. 2026-06-01> [out.tsv.gz]
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [, , file, version, outArg] = process.argv;
if (!file) {
  console.error("Usage: node scripts/build-data.mjs <BasicCompanyData.csv> <version> [out.tsv.gz]");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = outArg || join(root, "data/companies.tsv.gz");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"' && cur === "") inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const clean = (s) => (s || "").replace(/[\t\r\n]+/g, " ").trim();
function isoDate(s) {
  const m = clean(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : clean(s);
}

const gz = createGzip();
const ws = createWriteStream(outPath);
gz.pipe(ws);
gz.write(`##VERSION=${version || "unknown"}\n`);

const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });

let idx = null;
let n = 0;
let pending = "";

function processRecord(line) {
  if (!line) return;
  const cells = parseCsvLine(line);
  if (!idx) {
    const norm = cells.map((c) => c.replace(/^"|"$/g, "").trim());
    const find = (name) => norm.indexOf(name);
    idx = {
      number: find("CompanyNumber"),
      name: find("CompanyName"),
      status: find("CompanyStatus"),
      category: find("CompanyCategory"),
      incorp: find("IncorporationDate"),
      postcode: find("RegAddress.PostCode"),
      sic: find("SICCode.SicText_1"),
    };
    if (idx.number === -1 || idx.name === -1) {
      console.error("Could not find CompanyNumber/CompanyName columns — is this the Companies House CSV?");
      process.exit(1);
    }
    return;
  }
  const number = clean(cells[idx.number]).toUpperCase();
  if (!number) return;
  const row = [
    number,
    clean(cells[idx.name]),
    clean(cells[idx.status]),
    clean(cells[idx.category]),
    isoDate(cells[idx.incorp]),
    clean(cells[idx.postcode]),
    clean(cells[idx.sic]),
  ].join("\t");
  // Honour backpressure: if the gzip buffer is full, pause reading until it drains,
  // otherwise ~5.6M rows can balloon memory and OOM the CI runner.
  if (!gz.write(row + "\n")) {
    rl.pause();
    gz.once("drain", () => rl.resume());
  }
  n++;
  if (n % 500000 === 0) console.error(`  ...${n} companies`);
}

rl.on("line", (raw) => {
  // A quoted field (a company name, SIC text) may legally contain a newline, splitting
  // one CSV record across physical lines. Buffer until the quotes balance, then parse.
  pending = pending ? pending + "\n" + raw : raw;
  let quotes = 0;
  for (let i = 0; i < pending.length; i++) if (pending[i] === '"') quotes++;
  if (quotes % 2 !== 0) return; // unterminated quoted field — wait for the next line
  const line = pending;
  pending = "";
  processRecord(line);
});

rl.on("close", () => {
  if (pending) processRecord(pending);
  gz.end();
  ws.on("close", () => console.error(`wrote ${outPath} — ${n} companies (version ${version}).`));
});
