// NOTE: there is intentionally NO Cloudflare Worker for companieswise (yet).
//
// Unlike the small bundled-data tools, companieswise's real dataset is the ~5.6M-company
// Companies House snapshot, which (a) is far too large to bundle into a Worker and (b) is
// loaded from a local cache file via node:fs/zlib — neither of which exists in the Workers
// runtime. A hosted edge endpoint therefore requires moving the data into Cloudflare D1
// (or similar) and a Worker that queries it. That is a deliberate follow-on; for now
// companieswise ships as an npm library + stdio MCP server only.
//
// This file exists only to document that decision; it is excluded from the build.
export {};
