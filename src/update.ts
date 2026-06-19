#!/usr/bin/env node
// `companieswise-update` — download the latest Companies House snapshot artifact into
// the local cache so lookup_company / search_company use real data. Run once after
// install (and whenever you want to refresh); the monthly CI build keeps the artifact current.
import { downloadAndCache, DATA_URL_DEFAULT, cacheFile } from "./data.js";

async function main() {
  const url = process.argv[2] || DATA_URL_DEFAULT;
  console.error(`companieswise: downloading snapshot from ${url} ...`);
  const { path, bytes } = await downloadAndCache(url);
  console.error(`companieswise: saved ${(bytes / 1e6).toFixed(1)} MB to ${path}`);
  console.error("companieswise: done. lookup_company / search_company will now use the real snapshot.");
}

main().catch((err) => {
  console.error(`companieswise-update failed: ${(err as Error).message}`);
  console.error(`(cache target: ${cacheFile()})`);
  process.exit(1);
});
