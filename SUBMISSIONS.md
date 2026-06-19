# companieswise — directory submissions

The MCP Registry entry (via `mcp-publisher`) is canonical; Glama and mcp.so auto-ingest from it.

| Directory | How | Status |
| --- | --- | --- |
| MCP Registry (official) | `mcp-publisher publish` (PUBLISH.md §5) | ☐ |
| Glama | Auto-ingest from the registry; claim via `glama.json` maintainer. Never add billing. | ☐ |
| mcp.so | Auto-ingests from the registry. | ☐ |
| awesome-mcp-servers | Manual PR — batch with other Qiniso tools (see Qinisolabs/AWESOME_MCP_PENDING.md). | ☐ |
| Smithery | `smithery.yaml` present; list as stdio/npx. | ☐ |

## Notes

- companieswise is **UK-wide** Companies House data, a **monthly snapshot of the live register**
  (status as-of the dataset date, not real-time). Lead listings with that — it's not real-time and
  not KYC/AML advice.
- Description (≤100 chars): *Verified UK company lookup & number validation for AI agents — Companies House data, not guesses.*
- No API key, stdio/npx. After install, users run `npx companieswise-update` once for the real data.
