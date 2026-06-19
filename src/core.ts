// Single source of truth for companieswise's tools + a minimal, stateless JSON-RPC 2.0
// handler. The stdio server reuses the TOOLS array via the MCP SDK.
import { lookupCompany, validateCompanyNumber, searchCompany, datasetInfo } from "./company.js";

export type ArgType = "string" | "number";

export interface ToolArg {
  name: string;
  type: ArgType;
  description: string;
  optional?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  args: ToolArg[];
  run: (a: Record<string, unknown>) => unknown;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "lookup_company",
    description:
      "USE THIS to get a UK company's official registered details by its Companies House number — instead of recalling them, which models get wrong (invented names, wrong status). Returns the registered name, status, company type, incorporation date, registered-office postcode and primary SIC code from the official snapshot, or an honest 'not found'. IMPORTANT: the data is a MONTHLY snapshot of the LIVE register — status is as of the dataset date, not real-time, and dissolved companies are generally absent. UK-wide (England & Wales, Scotland, NI).",
    args: [{ name: "number", type: "string", description: "The UK company number, e.g. '00000006' or 'SC123456' (spaces/case ignored)." }],
    run: (a) => lookupCompany(String(a.number ?? "")),
  },
  {
    name: "validate_company_number",
    description:
      "USE THIS to check a UK company number is well-formed and identify its register/type before relying on it — never assume 8 characters are valid. Checks the format (8 digits, or a 2-letter prefix + 6 digits; there is NO check digit) and returns what the prefix denotes (e.g. SC = Scotland, NI = Northern Ireland, OC = LLP). Does NOT confirm the company exists — use lookup_company for that.",
    args: [{ name: "number", type: "string", description: "The UK company number to validate." }],
    run: (a) => validateCompanyNumber(String(a.number ?? "")),
  },
  {
    name: "search_company",
    description:
      "USE THIS to find a UK company's number from its name (reverse lookup) instead of guessing the number — returns companies whose official registered name contains all your search words, from the Companies House snapshot.",
    args: [
      { name: "query", type: "string", description: "Company name or keywords to search for." },
      { name: "limit", type: "number", description: "Max results (default 20).", optional: true },
    ],
    run: (a) => searchCompany(String(a.query ?? ""), a.limit === undefined ? 20 : Number(a.limit)),
  },
];

export const SERVER_INFO = { name: "companieswise", version: "0.1.0" } as const;
export const PUBLIC_BASE = "https://qinisolabs.github.io/companieswise";
const DEFAULT_PROTOCOL = "2025-06-18";

function jsonType(t: ArgType) {
  return t === "number" ? { type: "number" } : { type: "string" };
}
function inputSchema(t: ToolSpec) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const a of t.args) {
    properties[a.name] = { ...jsonType(a.type), description: a.description };
    if (!a.optional) required.push(a.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
export function listTools() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchema(t) }));
}
export function callTool(name: string, args: Record<string, unknown> | undefined) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) {
    const e: any = new Error(`Unknown tool: ${name}`);
    e.code = -32602;
    throw e;
  }
  const a: Record<string, unknown> = {};
  for (const arg of t.args) {
    const v = args?.[arg.name];
    a[arg.name] = v === undefined || v === null ? undefined : arg.type === "number" ? Number(v) : String(v);
  }
  return { content: [{ type: "text", text: JSON.stringify(t.run(a), null, 2) }] };
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: any;
}

export function handleRpc(msg: JsonRpcMessage): object | null {
  const { id, method, params } = msg;
  if (id === undefined || method === "notifications/initialized") return null;
  try {
    let result: unknown;
    switch (method) {
      case "initialize": {
        const info = datasetInfo();
        result = {
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { ...SERVER_INFO, websiteUrl: PUBLIC_BASE },
          instructions:
            `companieswise looks up UK companies in the official Companies House snapshot (dataset '${info.kind}', version ${info.version}, ${info.size} companies loaded). Use lookup_company for a company's registered details by number, validate_company_number to check a number's format/register, and search_company to find a number by name. The data is a MONTHLY snapshot of the LIVE register — status is as of the dataset date, NOT real-time, and dissolved companies are generally absent; for current status check the live register. It returns an honest "not found" rather than guessing. UK-wide. Not legal, financial or KYC/AML advice.`,
        };
        break;
      }
      case "tools/list":
        result = { tools: listTools() };
        break;
      case "tools/call":
        result = callTool(params?.name, params?.arguments);
        break;
      case "ping":
        result = {};
        break;
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
    return { jsonrpc: "2.0", id, result };
  } catch (err: any) {
    return { jsonrpc: "2.0", id, error: { code: err?.code ?? -32603, message: err?.message ?? String(err) } };
  }
}
