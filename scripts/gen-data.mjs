// Generates src/data.generated.ts from data/companies.sample.tsv.
//
// IMPORTANT: only the small ILLUSTRATIVE SAMPLE is bundled into the package. The real
// Companies House dataset (~5.6M companies) is far too large to ship in npm — it is built
// monthly by CI into a GitHub Release artifact, which `companieswise-update` downloads to a
// local cache (see src/data.ts). The bundled sample lets the tool run out of the box (tagged
// dataset: "sample") and lets tests pass without the real data.
//
// The sample is emitted as one packed STRING literal (TSV rows) so tsc stays fast; it's
// parsed into a Map at load.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsv = readFileSync(join(root, "data/companies.sample.tsv"), "utf8");

const out = `// AUTO-GENERATED from data/companies.sample.tsv by scripts/gen-data.mjs — do not edit by hand.
// Tab-separated rows: number, name, status, category, incorporationDate, postcode, sic.
// Line 0 is "##VERSION=<v>". Typed as string so the emitted .d.ts stays tiny.
export const SAMPLE_DATA: string = ${JSON.stringify(tsv)};
`;

writeFileSync(join(root, "src/data.generated.ts"), out);
const rows = tsv.split(/\r?\n/).filter((l) => l && !l.startsWith("##")).length;
console.error(`generated src/data.generated.ts (${rows} sample companies)`);
