import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateCompanyNumber,
  normalizeNumber,
  lookupCompany,
  searchCompany,
  datasetInfo,
  chApiKey,
} from "../src/index.js";
import { resetDataset } from "../src/data.js";
import { handleRpc } from "../src/core.js";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error(`✗ ${name}\n    ${(err as Error).message}`);
  }
}

/* ---------- number normalisation + validation (deterministic) ---------- */
check("normalize pads digits to 8", () => assert.equal(normalizeNumber("6"), "00000006"));
check("normalize uppercases + pads prefixed", () => assert.equal(normalizeNumber("sc12345"), "SC012345"));
check("normalize strips spaces", () => assert.equal(normalizeNumber(" 1234 5678 "), "12345678"));

check("validate 8-digit → E&W", () => {
  const r = validateCompanyNumber("00000006");
  assert.equal(r.valid, true);
  assert.equal(r.prefix, null);
  assert.match(r.meaning!, /England & Wales/);
});
check("validate SC prefix → Scotland", () => {
  const r = validateCompanyNumber("SC123456");
  assert.equal(r.valid, true);
  assert.equal(r.prefix, "SC");
  assert.match(r.meaning!, /Scotland/);
});
check("validate OC prefix → LLP", () => assert.match(validateCompanyNumber("OC123456").meaning!, /Liability Partnership/));
check("validate pads short input then accepts", () => assert.equal(validateCompanyNumber("123").valid, true));
check("validate rejects gibberish", () => assert.equal(validateCompanyNumber("HELLO").valid, false));
check("validate rejects too-long", () => assert.equal(validateCompanyNumber("123456789").valid, false));

/* ---------- lookup + search against the bundled sample ---------- */
check("dataset is the sample by default", () => assert.equal(datasetInfo().kind, "sample"));
check("lookup sample company", () => {
  const r = lookupCompany("99999001");
  assert.equal(r.found, true);
  assert.equal(r.name, "SAMPLE ALPHA TRADING LIMITED");
  assert.equal(r.status, "Active");
  assert.equal(r.companyType, "Private Limited Company");
  assert.equal(r.coverage, "United Kingdom");
  assert.equal(r.dataset, "sample");
});
check("lookup well-formed but absent → not found, no guess", () => {
  const r = lookupCompany("00000006");
  assert.equal(r.wellFormed, true);
  assert.equal(r.found, false);
  assert.equal(r.name, null);
  assert.ok(r.note && r.note.length > 0);
});
check("lookup malformed → error", () => {
  const r = lookupCompany("nope");
  assert.equal(r.wellFormed, false);
  assert.equal(r.errors.length, 1);
});
check("lookup always carries OGL attribution", () => assert.match(lookupCompany("99999001").attribution, /Open Government Licence/));
check("search by keyword finds all sample rows", () => {
  const r = searchCompany("sample");
  assert.equal(r.count, 6);
});
check("search narrows by multiple words", () => {
  const r = searchCompany("beta holdings");
  assert.equal(r.count, 1);
  assert.equal(r.results[0].number, "99999002");
});
check("search respects limit", () => assert.equal(searchCompany("sample", 2).results.length, 2));

/* ---------- JSON-RPC core (sample) + live-mode routing — handleRpc is async ---------- */
async function rpc(method: string, params?: unknown, id: number | string = 1) {
  return (await handleRpc({ jsonrpc: "2.0", id, method, params })) as any;
}
async function asyncChecks() {
  {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18" });
    check("initialize returns companieswise serverInfo", () =>
      assert.equal(r.result.serverInfo.name, "companieswise"));
    check("initialize reports SNAPSHOT mode when no key is set", () =>
      assert.match(r.result.instructions, /SNAPSHOT mode/));
  }
  {
    const r = await rpc("tools/list");
    check("tools/list returns the three tools", () => {
      const names = r.result.tools.map((t: any) => t.name).sort();
      assert.deepEqual(names, ["lookup_company", "search_company", "validate_company_number"]);
    });
  }
  {
    const r = await rpc("tools/call", { name: "lookup_company", arguments: { number: "99999001" } });
    check("tools/call lookup_company", () =>
      assert.equal(JSON.parse(r.result.content[0].text).name, "SAMPLE ALPHA TRADING LIMITED"));
  }
  {
    const r = await rpc("tools/call", { name: "validate_company_number", arguments: { number: "SC123456" } });
    check("tools/call validate_company_number", () =>
      assert.equal(JSON.parse(r.result.content[0].text).prefix, "SC"));
  }
  {
    const r = await rpc("tools/call", { name: "nope", arguments: {} });
    check("unknown tool → error", () => assert.ok(r.error));
  }
  {
    const r = await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    check("notifications/initialized → null", () => assert.equal(r, null));
  }
  // BYO-key live mode — offline checks (key detection + init wording); no network calls.
  check("chApiKey is undefined with no env var", () => {
    delete process.env.COMPANIESWISE_CH_API_KEY;
    delete process.env.CH_API_KEY;
    assert.equal(chApiKey(), undefined);
  });
  check("chApiKey reads COMPANIESWISE_CH_API_KEY", () => {
    process.env.COMPANIESWISE_CH_API_KEY = "k-123";
    assert.equal(chApiKey(), "k-123");
    delete process.env.COMPANIESWISE_CH_API_KEY;
  });
  {
    process.env.COMPANIESWISE_CH_API_KEY = "k-123";
    const r = await rpc("initialize", {});
    check("initialize reports LIVE mode when a key is set", () =>
      assert.match(r.result.instructions, /LIVE mode/));
    delete process.env.COMPANIESWISE_CH_API_KEY;
  }
}

/* ---------- snapshot-load path (the real-data mechanism, via a temp file) ---------- */
check("loads a real snapshot from COMPANIESWISE_DATA_FILE", () => {
  const f = join(tmpdir(), `cw-test-${process.pid}.tsv`);
  writeFileSync(
    f,
    "##VERSION=2026-06-01\n12345678\tACME REAL LIMITED\tActive\tPrivate Limited Company\t2001-03-04\tEC1A 1BB\t62012 - Software\n"
  );
  process.env.COMPANIESWISE_DATA_FILE = f;
  resetDataset();
  const info = datasetInfo();
  assert.equal(info.kind, "snapshot");
  assert.equal(info.version, "2026-06-01");
  const r = lookupCompany("12345678");
  assert.equal(r.found, true);
  assert.equal(r.name, "ACME REAL LIMITED");
  assert.equal(r.dataset, "snapshot");
  // a sample number is no longer present once the real snapshot is loaded
  assert.equal(lookupCompany("99999001").found, false);
  delete process.env.COMPANIESWISE_DATA_FILE;
  resetDataset();
});

/* ---------- review-hardening regression checks ---------- */
check("validate recognises an expanded prefix (AC)", () =>
  assert.match(validateCompanyNumber("AC123456").meaning!, /Assurance/));
check("validate flags an unrecognised prefix honestly (still structural)", () => {
  const r = validateCompanyNumber("QQ123456");
  assert.equal(r.valid, true);
  assert.match(r.meaning!, /not a recognised/i);
});
check("search tolerates a NaN limit (defaults to 20)", () => {
  resetDataset();
  assert.equal(searchCompany("sample", Number("oops")).count, 6);
});
check("corrupt/empty snapshot falls back to the sample, never serves empty", () => {
  const f = join(tmpdir(), `cw-bad-${process.pid}.tsv`);
  writeFileSync(f, "this is not a valid artifact, no version header, no tab rows\n");
  process.env.COMPANIESWISE_DATA_FILE = f;
  resetDataset();
  assert.equal(datasetInfo().kind, "sample");
  assert.equal(lookupCompany("99999001").found, true); // sample still works
  delete process.env.COMPANIESWISE_DATA_FILE;
  resetDataset();
});

check("search ranks prefix/exact above incidental substring (+ totalMatches)", () => {
  const f = join(tmpdir(), `cw-rank-${process.pid}.tsv`);
  writeFileSync(
    f,
    "##VERSION=2026-06-01\n" +
      "00000001\tATESCO CONSULTANCY LTD\tActive\tPrivate Limited Company\t2010-01-01\tEC1A 1BB\t62012 - x\n" +
      "00000002\tTESCO STORES LIMITED\tActive\tPrivate Limited Company\t1947-01-01\tAL7 1GA\t47110 - x\n" +
      "00000003\tTESCO PLC\tActive\tPublic Limited Company\t1947-11-27\tAL7 1GA\t47110 - x\n"
  );
  process.env.COMPANIESWISE_DATA_FILE = f;
  resetDataset();
  const r = searchCompany("tesco");
  assert.equal(r.totalMatches, 3); // all three names contain "tesco"
  assert.equal(r.results[0].name, "TESCO PLC"); // prefix + shortest ranks first
  assert.equal(r.results[r.results.length - 1].name, "ATESCO CONSULTANCY LTD"); // substring ranks last
  delete process.env.COMPANIESWISE_DATA_FILE;
  resetDataset();
});

asyncChecks().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
});
