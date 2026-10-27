import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designWithCandidates } from "../src/engine/design/pmCandidates.js";
import { rankCandidates, buildCandidateRankingRequest } from "../src/services/candidateRanking.js";
import {
  HELPER_DEFAULT_URL, HELPER_SCHEMA, HELPER_START_COMMAND, HelperError, checkHelper, loadHelperSettings, normalizeHelperUrl, runHelperComparison, runHelperRanking, saveHelperSettings,
} from "../src/services/alphaGenomeHelper.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, ...p), "utf8");
const APOE = read("..", "public", "references", "apoe-ensg00000130203.gb");
// What the real Python helper sent in its own tests (tools/alphagenome/test_helper.py regenerates and checks this file).
const WIRE = JSON.parse(read("fixtures", "alphagenome-helper", "wire.json"));
const OPTIONS = { deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: "APOE" };
const MAPPING = { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: 1 };
const URL0 = "http://127.0.0.1:8765";

const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new SyntaxError("no body"); return body; } });
const replay = (name) => response(WIRE.errors[name].status, { error: WIRE.errors[name].error, code: WIRE.errors[name].code });
/** A fetch that records every call and answers like the helper did on the wire. */
function mockHelper(answer) {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  fetchFn.calls = calls; return fetchFn;
}

test("helper address: plain http only for this computer, https otherwise, no credentials", () => {
  assert.equal(normalizeHelperUrl("http://127.0.0.1:8765/"), "http://127.0.0.1:8765");
  assert.equal(normalizeHelperUrl("127.0.0.1:8765"), "http://127.0.0.1:8765");
  assert.equal(normalizeHelperUrl(" localhost:9000/rank "), "http://localhost:9000");
  assert.equal(normalizeHelperUrl("https://lab-gpu.example.org:8443/x"), "https://lab-gpu.example.org:8443");
  for (const bad of ["", "   ", "http://lab-gpu.example.org:8765", "http://192.168.1.20:8765", "ftp://127.0.0.1", "http://user:pw@127.0.0.1:8765", "http://", "http://[::1]:8765"]) {
    assert.throws(() => normalizeHelperUrl(bad), (e) => e instanceof HelperError && e.code === "bad-url", JSON.stringify(bad));
  }
});

test("health check: reads the helper's identity, and tells a wrong service or a refusal from a missing helper", async () => {
  const good = mockHelper(() => response(200, WIRE.health.body));
  const out = await checkHelper(URL0, { fetchFn: good });
  assert.equal(out.ok, true); assert.equal(out.health.schema, HELPER_SCHEMA); assert.equal(out.health.keyConfigured, true);
  assert.equal(good.calls[0].url, `${URL0}/health`); assert.equal(good.calls[0].init.method, "GET");
  assert.equal(good.calls[0].init.targetAddressSpace, "loopback", "Chrome's local-network check is told the target is this computer");
  assert.equal(good.calls[0].init.credentials, "omit");
  assert.equal(good.calls[0].init.headers, undefined, "a plain GET: no custom headers, so no preflight for the health check itself");

  const other = await checkHelper(URL0, { fetchFn: mockHelper(() => response(200, { hello: "world" })) });
  assert.deepEqual([other.ok, other.code], [false, "wrong-service"]);
  const html = await checkHelper(URL0, { fetchFn: mockHelper(() => response(200, undefined)) });
  assert.deepEqual([html.ok, html.code], [false, "wrong-service"]);
  const refused = await checkHelper(URL0, { fetchFn: mockHelper(() => replay("bad-origin")) });
  assert.deepEqual([refused.ok, refused.code], [false, "bad-origin"]); assert.match(refused.message, /--origin/);
  const down = await checkHelper(URL0, { fetchFn: mockHelper(() => { throw new TypeError("Failed to fetch"); }) });
  assert.deepEqual([down.ok, down.code], [false, "unreachable"]);
  assert.ok(down.message.includes(HELPER_START_COMMAND), "says how to start it");
  assert.match(down.message, /Chrome asks for permission/); assert.match(down.message, /Safari/);
  const badUrl = await checkHelper("http://lab-gpu.example.org", { fetchFn: good });
  assert.deepEqual([badUrl.ok, badUrl.code], [false, "bad-url"]);
  assert.equal(good.calls.length, 1, "the refused address was never contacted");
});

test("ranking call: sends the request with the session code to the configured address, and nothing else", async () => {
  const request = { requestId: "abc123", schema: "x", contexts: ["CL:0000679"] };
  const fetchFn = mockHelper(() => response(200, { requestId: "abc123", schema: "report" }));
  const report = await runHelperRanking(request, { url: "http://localhost:8765/", token: " session-code-123 ", fetchFn });
  assert.deepEqual(report, { requestId: "abc123", schema: "report" });
  const { url, init } = fetchFn.calls[0];
  assert.equal(url, "http://localhost:8765/rank"); assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/json", "X-Assured-Token": "session-code-123" });
  assert.deepEqual(JSON.parse(init.body), request); assert.equal(init.targetAddressSpace, "loopback"); assert.equal(init.cache, "no-store");
  assert.ok(!url.includes("session-code") && !init.body.includes("session-code"), "the session code travels only in its header");

  const remote = mockHelper(() => response(200, { ok: 1 }));
  await runHelperRanking(request, { url: "https://lab-gpu.example.org", token: "t", fetchFn: remote });
  assert.equal("targetAddressSpace" in remote.calls[0].init, false, "not a local address: no loopback hint");

  await assert.rejects(runHelperRanking(request, { url: URL0, token: "  ", fetchFn }), (e) => e.code === "bad-token");
  await assert.rejects(runHelperRanking({}, { url: URL0, token: "t", fetchFn }), (e) => e.code === "bad-request");
  assert.equal(fetchFn.calls.length, 1, "nothing was sent without a code or a request");
});

test("ranking call: every refusal the helper sends becomes a message that says what to do", async () => {
  const request = { requestId: "abc123" };
  const expected = { "bad-token": /session code .* wrong/i, "bad-origin": /--origin/, busy: /already running/, "no-key": /configure_key\.py/, "too-large": /larger than the helper accepts/, "bad-json": /not valid JSON/ };
  for (const [name, pattern] of Object.entries(expected)) {
    await assert.rejects(runHelperRanking(request, { url: URL0, token: "t", fetchFn: mockHelper(() => replay(name)) }), (e) => {
      assert.ok(e instanceof HelperError); assert.equal(e.code, WIRE.errors[name].code); assert.equal(e.status, WIRE.errors[name].status); assert.match(e.message, pattern, name); return true;
    });
  }
  // Server-side texts for 4xx/5xx that carry their own explanation are passed through; upstream text never reaches the helper's reply, so none can reach the page.
  await assert.rejects(runHelperRanking(request, { url: URL0, token: "t", fetchFn: mockHelper(() => response(502, { code: "upstream", error: "The prediction service did not complete the request (RuntimeError)." })) }), /RuntimeError/);
  await assert.rejects(runHelperRanking(request, { url: URL0, token: "t", fetchFn: mockHelper(() => response(404, undefined)) }), (e) => e.code === "wrong-service");
  await assert.rejects(runHelperRanking(request, { url: URL0, token: "t", fetchFn: mockHelper(() => { throw new TypeError("NetworkError when attempting to fetch resource."); }) }), (e) => e.code === "unreachable" && e.message.includes(HELPER_START_COMMAND));
});

test("ranking call: a slow helper times out with a message that does not blame the network, and cancelling is reported as such", async () => {
  const slow = mockHelper((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })));
  await assert.rejects(runHelperRanking({ requestId: "r" }, { url: URL0, token: "t", fetchFn: slow, timeoutMs: 20 }), (e) => e.code === "timeout" && /may still be running/.test(e.message));
  const controller = new AbortController();
  const hung = mockHelper((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })));
  const pending = runHelperRanking({ requestId: "r" }, { url: URL0, token: "t", fetchFn: hung, timeoutMs: 5000, signal: controller.signal });
  controller.abort(new Error("user"));
  await assert.rejects(pending, (e) => e.code === "cancelled");
});

test("one-click path: request built from the candidate set, report checked against it, ranking identical to the manual route", async () => {
  const design = designWithCandidates(APOE, "R176C", OPTIONS);
  const project = { gene: "APOE", genbankRaw: APOE, designResult: design };
  const contexts = ["glutamatergic-neuron", "wtc11"];
  const posted = [];
  const helperFetch = mockHelper((url, init) => {
    const body = JSON.parse(init.body); posted.push(body);
    const report = JSON.parse(read("fixtures", "alphagenome-ranking", "apoe-r176c-report.json")); report.requestId = body.requestId;
    return response(200, report);
  });
  const out = await runHelperComparison(project, design.pmCandidates, { contexts, mapping: MAPPING, mappingConfirmed: true, url: URL0, token: WIRE.token, fetchFn: helperFetch });
  assert.equal(posted.length, 1); assert.equal(posted[0].schema, "assured-alphagenome-candidates-request/1"); assert.equal(posted[0].requestId, out.setup.request.requestId);
  assert.deepEqual(out.ranking.top.length, 2); assert.equal(out.ranking.tie, true); assert.match(out.ranking.wording, /^Equally supported among 4 candidates evaluated in Glutamatergic neuron: /);

  const setup = await buildCandidateRankingRequest(project, design.pmCandidates, { contexts, mapping: MAPPING, mappingConfirmed: true });
  const manual = rankCandidates(design.pmCandidates, { ...setup, report: (() => { const r = JSON.parse(read("fixtures", "alphagenome-ranking", "apoe-r176c-report.json")); r.requestId = setup.request.requestId; return r; })() });
  assert.deepEqual(out.ranking, manual, "same request, same report, same rule: the one-click and manual routes agree");

  // A report that answers a different request is refused, not ranked.
  const stale = mockHelper(() => response(200, JSON.parse(read("fixtures", "alphagenome-ranking", "apoe-r176c-report.json"))));
  await assert.rejects(runHelperComparison(project, design.pmCandidates, { contexts, mapping: MAPPING, mappingConfirmed: true, url: URL0, token: "t", fetchFn: stale }), (e) => e.code === "invalid-report" && /refused/.test(e.message));
  // An unconfirmed mapping stops before anything is sent.
  const untouched = mockHelper(() => response(200, {}));
  await assert.rejects(runHelperComparison(project, design.pmCandidates, { contexts, mapping: MAPPING, mappingConfirmed: false, url: URL0, token: "t", fetchFn: untouched }), /Confirm the assembly/);
  assert.equal(untouched.calls.length, 0);
});

test("settings: the address may be remembered, the session code only for the tab", () => {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }; };
  const local = store(), session = store();
  assert.deepEqual(loadHelperSettings({ local, session }), { url: HELPER_DEFAULT_URL, token: "" });
  saveHelperSettings({ url: "http://127.0.0.1:9001", token: "abc" }, { local, session });
  assert.deepEqual(loadHelperSettings({ local, session }), { url: "http://127.0.0.1:9001", token: "abc" });
  assert.ok([...local.map.values()].every((v) => !v.includes("abc")), "the code is not in localStorage");
  assert.ok([...session.map.values()].every((v) => !v.includes("9001")));
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadHelperSettings({ local: broken, session: broken }), { url: HELPER_DEFAULT_URL, token: "" });
  assert.doesNotThrow(() => saveHelperSettings({ url: "x", token: "y" }, { local: broken, session: broken }));
});

test("wire contract: the replayed helper answers carry what a cross-origin browser call needs", () => {
  assert.equal(WIRE.health.headers["Access-Control-Allow-Origin"], WIRE.origin);
  assert.equal(WIRE.health.headers["Access-Control-Allow-Private-Network"], "true");
  assert.equal(WIRE.preflight.status, 204); assert.equal(WIRE.preflight.headers["Access-Control-Allow-Private-Network"], "true");
  assert.match(WIRE.preflight.headers["Access-Control-Allow-Headers"], /X-Assured-Token/); assert.match(WIRE.preflight.headers["Access-Control-Allow-Headers"], /Content-Type/);
  assert.equal(WIRE.health.body.schema, HELPER_SCHEMA);
  assert.ok(!JSON.stringify(WIRE.health.body).toLowerCase().includes("key\":\""), "health reports whether a key exists, never the key");
  assert.equal(new URL(URL0).origin, URL0);
});

test("the deployed Content-Security-Policy lets the page reach the helper at its default address, and nothing wider than this computer", () => {
  const vercel = JSON.parse(read("..", "vercel.json"));
  const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src ")).split(/\s+/).slice(1);
  const allowed = (origin) => { const u = new URL(origin); return connect.some((source) => { const m = /^(https?):\/\/([^:/]+)(?::(\*|\d+))?$/.exec(source); return m && `${m[1]}:` === u.protocol && m[2] === u.hostname && (m[3] === "*" || m[3] === (u.port || (u.protocol === "https:" ? "443" : "80"))); }); };
  assert.ok(allowed(HELPER_DEFAULT_URL), "a browser would block the helper call without this");
  assert.ok(allowed("http://localhost:9000"));
  assert.ok(!allowed("http://192.168.1.20:8765") && !allowed("http://example.org:8765"));
  assert.ok(connect.includes("https:"), "an https helper elsewhere (the lab server option) stays reachable");
});
