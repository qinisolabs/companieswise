# companieswise — architecture & data decision

## The problem

The Companies House "Free Company Data Product" is ~5.6M companies. With company names it's
hundreds of MB of text — **too large to bundle into an npm package** the way the small Qiniso
data tools (e.g. floodwise, 1.46M rows of short fields) do. So we split code from data.

## The design (v0.1) — free, no hosting cost, no manual work

- **Code → npm** (`companieswise`), tiny. Ships an illustrative sample only.
- **Data → GitHub Release artifact.** A monthly GitHub Action downloads the official snapshot
  (`BasicCompanyDataAsOneFile-YYYY-MM-01.zip`, a stable dated URL), compiles a compact gzipped
  tab-separated artifact (`companies.tsv.gz`, KYC-relevant fields only), and uploads it to the
  rolling **`data`** release with `--clobber`.
- **`companieswise-update`** fetches that artifact into a local cache; the library/server load it
  from there (falling back to the bundled sample if absent).

### Why this is the right v0.1

| Property | Outcome |
| --- | --- |
| Hosting cost | **£0** — GitHub Releases hosts the data for free; no server runs. |
| Companies House API rate limit (600/5min) | **Not hit** — we host the snapshot; we never call the API at request time. |
| Manual work | **None** after setup — the monthly Action refreshes the artifact automatically. |
| Secrets needed for the refresh | **None** beyond the automatic `GITHUB_TOKEN` (data isn't published to npm, so no npm token). |

### Trade-offs (deliberate)

- **First-use step:** users run `npx companieswise-update` once to pull the real data (the package
  ships sample-only to stay small). Documented prominently.
- **Freshness:** monthly. Company *status* changes daily, so the snapshot can lag — surfaced via
  `datasetVersion` and the "as of the dataset date, not real-time" framing throughout.
- **Memory:** loading ~5.6M rows into a Map is ~1–2 GB RAM and a few seconds at first lookup. Fine
  for a desktop MCP server; noted here.
- **Search** is a linear scan (O(n)); acceptable at this size, an index can come later.

## Follow-ons (not in v0.1)

- **Real-time / hosted tier (the paid path).** Bootstrap from the snapshot's stream *timepoint*,
  then consume the free Companies House **Streaming API** continuously into **Cloudflare D1**
  (or Postgres) so a hosted Worker serves always-current status. This needs an always-on backend
  and is where hosting cost (and the monetisable value) lives — hence no `worker.ts`/`wrangler` here
  (the Workers runtime has no `fs`, and the dataset can't bundle into a Worker).
- **Richer fields** (officers, PSCs, filings, charges) are not in the free snapshot — those need the
  REST API (per-user key) or the streaming feed.
