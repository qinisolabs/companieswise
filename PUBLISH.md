# Publishing companieswise

Run these on your Mac (npm 2FA + `gh` auth as `kristaffa`). From the repo root: `cd companieswise`.

Unlike the bundled-data tools, the **data is not in npm** — it's a GitHub Release artifact built by
CI. So publishing has two tracks: publish the **code** (npm + registry), and bootstrap the **data**
(run the Action once). The monthly data refresh needs **no secrets** (just the automatic
`GITHUB_TOKEN`); only the manual `npm publish` uses your npm 2FA.

---

## 1. Pre-flight (build + test + scrub + pack)

```
npm install
npm run build
npm test
node -e "import('./dist/index.js').then(m=>console.log('dataset', JSON.stringify(m.datasetInfo())))"
npm pack --dry-run
grep -rniE "anthropic|/Users/|TODO|FIXME" src scripts docs README.md
```

Tests should pass; the dataset should report `kind: "sample"`; pack should be tiny and ship only
`dist/ README LICENSE NOTICE`; the grep should print nothing.

## 2. Publish the code to npm

Unscoped (`companieswise`). If npm 403s "too similar", scope to `@qinisolabs/companieswise`
(update `package.json` name, `server.json` identifier, README/docs install strings) and republish.

```
npm whoami
npm publish --access public
```

## 3. GitHub repo + push

The email line MUST print `qinisolabs@gmail.com` before the first commit (never `--global`).

```
git init
git config user.name "Qiniso"
git config user.email "qinisolabs@gmail.com"
git config user.email
git add .
git status
git commit -m "Initial commit: companieswise"
git branch -M main
gh repo create qinisolabs/companieswise --source=. --remote=origin --push --public --description "Verified UK company lookup & number validation for AI agents — Companies House data, not guesses."
gh repo edit qinisolabs/companieswise --add-topic mcp,model-context-protocol,agents,llm,companies-house,uk-company,kyc,registry,typescript
gh repo edit qinisolabs/companieswise --homepage "https://qinisolabs.github.io/companieswise"
git log --format='%an <%ae>' -1
```

## 4. Bootstrap the data (run the Action once)

The first run creates the `data` release that `companieswise-update` downloads from. Needs no secret.

```
gh workflow run "Refresh Companies House data"
gh run watch
gh release view data
```

It downloads the current month's snapshot, builds `companies.tsv.gz`, and uploads it to the `data`
release. After this, anyone can run `npx companieswise-update`. The workflow then re-runs
automatically on the 10th of each month. (Use `gh workflow run "Refresh Companies House data" -f month=YYYY-MM`
to backfill a specific month.)

Sanity-check end to end:

```
npx companieswise-update
node -e "import('companieswise').then(m=>console.log(m.lookupCompany('00000006')))"
```

## 5. MCP Registry

```
mcp-publisher login github
mcp-publisher publish
```

## 6. GitHub Pages

```
gh api -X POST repos/qinisolabs/companieswise/pages --input - <<'JSON'
{"source":{"branch":"main","path":"/docs"}}
JSON
```

Live at <https://qinisolabs.github.io/companieswise>.

## Notes

- **No hosted Worker** (see `ARCHITECTURE.md`): the dataset can't bundle into a Worker and needs
  `fs`; the hosted/real-time path is Cloudflare D1 + the Streaming API, a deliberate follow-on.
- Track directory submissions in `SUBMISSIONS.md` (Glama / mcp.so auto-ingest from the registry).
