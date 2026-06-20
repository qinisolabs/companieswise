<div align="center">

<img src="https://qinisolabs.github.io/companieswise/logo.svg" width="96" height="96" alt="Qiniso" />

# companieswise

**Verified UK company lookup & number validation for AI agents — official Companies House data, not guesses.**

*Verified, trustworthy data tools for AI agents. "Qiniso" means "truth" in Zulu.*

[Website](https://qinisolabs.github.io/companieswise/) · [npm](https://www.npmjs.com/package/companieswise) · [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=companieswise)

</div>

---

Ask an LLM "what's the registered name and status of company `00445790`?" and it will answer confidently — and usually **wrongly**: invented names, the wrong status, a fabricated incorporation date. Company records live in the Companies House register, not a model's weights. **companieswise** looks the number up in the official Companies House snapshot and returns the real registered details — or an honest *"not found"* instead of a guess.

## ⚠️ Read this first — what the data is

- **UK-wide** (England & Wales, Scotland, Northern Ireland).
- **A monthly snapshot of the *live* register.** Company **status is as of the dataset date, not real-time** — a company dissolved last week may still read "Active" until the next snapshot, and dissolved companies are generally absent. For current status, check the live register.
- **Not advice.** Not legal, financial, credit, or KYC/AML advice, and not a substitute for statutory due diligence.

## Install

```json
{ "mcpServers": { "companieswise": { "command": "npx", "args": ["-y", "companieswise"] } } }
```

Then load the real data once (the package ships with only a small sample):

```bash
npx -p companieswise companieswise-update
```

This downloads the latest monthly Companies House snapshot (~tens of MB) to a local cache. Re-run it whenever you want to refresh; a GitHub Action rebuilds the snapshot monthly, so `companieswise-update` always fetches the current month. Until you run it, `validate_company_number` works fully and `lookup_company`/`search_company` clearly say they're on the sample.

## Optional: live mode (BYO key)

By default companieswise serves the monthly **snapshot** (offline, no key). If you set a free [Companies House API key](https://developer.company-information.service.gov.uk/), it switches to **live** queries against the official Companies House API instead — real-time register status, including dissolved companies, on your own key (no shared rate limit):

```json
{
  "mcpServers": {
    "companieswise": {
      "command": "npx",
      "args": ["-y", "companieswise"],
      "env": { "COMPANIESWISE_CH_API_KEY": "your-companies-house-api-key" }
    }
  }
}
```

`lookup_company` and `search_company` use the live API when the key is set (results tagged `"dataset": "live"`) and fall back to the snapshot when it isn't (`"dataset": "snapshot"`), so it's always clear which you're getting. `validate_company_number` is offline either way. The key is sent only to the official Companies House API. `CH_API_KEY` is accepted as an alias.

## Use it as a library

```bash
npm i companieswise
```

```ts
import { lookupCompany, validateCompanyNumber, searchCompany } from "companieswise";

validateCompanyNumber("SC123456");   // { valid: true, prefix: "SC", meaning: "Company registered in Scotland" }
validateCompanyNumber("6").number;   // "00000006" — normalises/zero-pads
lookupCompany("00000006");           // official name, status, type, incorporation date, postcode, SIC — or found:false
searchCompany("greggs");             // companies whose registered name contains your words
```

A well-formed number that isn't in the snapshot returns `found: false` with a clear note — it never invents a company.

## Tools — 3

| Tool | What it answers |
| --- | --- |
| **lookup_company** | A company's official registered details by number (name, status, type, incorporation date, registered postcode, primary SIC) |
| **validate_company_number** | Is this a well-formed UK company number, and what does its prefix denote? (format only — there is no check digit) |
| **search_company** | Reverse lookup — find a company's number from its name |

## Data & monthly auto-refresh

The data is the Companies House **Free Company Data Product** (UK-wide, live register), published under the **Open Government Licence v3.0**. Because the real dataset is ~5.6M companies — far too large to bundle into an npm package — the design splits **code** from **data**:

- **Code** ships on npm (tiny).
- **Data** is built monthly by a GitHub Action (`.github/workflows/refresh-data.yml`) that downloads the official snapshot, compiles a compact artifact, and publishes it as a **GitHub Release** asset.
- **`companieswise-update`** downloads that artifact into a local cache; every response reports its `datasetVersion` (the snapshot date).

No API key, no rate limit, no per-request cost — lookups run locally against the cached snapshot. See `ARCHITECTURE.md` for why, and the hosted/real-time path.

## What it is *not*

- **Not real-time.** Monthly snapshot of the live register; status is as of the dataset date. For live status use the Companies House API/website.
- **Not the full register.** The free snapshot is *live* companies; dissolved companies are generally absent (absent ≠ "never existed").
- **Not advice**, and not a statutory KYC/AML check.
- **Not a guesser** — unknown numbers return an honest "not found".

## Privacy

This tool runs locally on your machine and is built not to collect, store, or transmit your data — no analytics, no telemetry, no account. By default it uses bundled/cached data offline; **only if you set a Companies House API key** does it send your lookup and key **directly to the official Companies House API** (never to Qiniso). Full policy: <https://qinisolabs.github.io/privacy.html>.

## License

Apache-2.0. Company data © Crown copyright, Companies House, Open Government Licence v3.0; see `NOTICE`.
