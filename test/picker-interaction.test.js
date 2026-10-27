/**
 * The picker running as a component: effects, state and click handlers, through react-test-renderer (the other picker tests render once to a string).
 * Ensembl and the local helper are replaced by fakes; nothing here touches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = TestRenderer;
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const APOE = read("../public/references/apoe-ensg00000130203.gb");
const UNLOCATED = APOE.replace(/GRCh38[\s\S]{0,120}?Location:\s*chr\d+\s+\d+-\d+/i, "location not stated");
const OPTIONS = { enzyme: "spcas9", deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: "APOE" };
const TRUE_START = 44905754;

async function withModules(fn) {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const cand = await vite.ssrLoadModule("/src/engine/design/pmCandidates.js");
    const picker = await vite.ssrLoadModule("/src/components/design/PmCandidatePicker.jsx");
    const design = cand.designWithCandidates(APOE, "R176C", OPTIONS);
    return await fn({ picker, design });
  } finally { await vite.close(); }
}

const reply = (status, json, text) => ({ status, ok: status >= 200 && status < 300, json: async () => json, text: async () => text });
/** Ensembl stand-in: the bundled APOE reference at its true position is the whole "genome". `gate` can hold the answers back. */
function fakeEnsembl(design, { gate = null } = {}) {
  const genome = design.gb.genomicSequence; const log = [];
  const gene = { object_type: "Gene", id: "ENSG00000130203", display_name: "APOE", seq_region_name: "19", assembly_name: "GRCh38", strand: 1, start: TRUE_START + 700, end: TRUE_START + genome.length - 500 };
  const fetchImpl = async (url) => {
    log.push(url); if (gate) await gate;
    if (url.includes("/lookup/")) return reply(200, gene);
    const m = /:(\d+)\.\.(\d+):1/.exec(url); const a = Number(m[1]), b = Number(m[2]);
    if (a < TRUE_START || b >= TRUE_START + genome.length) return reply(400, {});
    return reply(200, null, genome.slice(a - TRUE_START, b - TRUE_START + 1));
  };
  return { fetchImpl, log };
}
const text = (node) => (node.children || []).map((c) => (typeof c === "string" ? c : text(c))).join("");
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 4)); }); };
const find = (root, pred) => root.findAll(pred);
const note = (root) => text(find(root, (n) => n.type === "p" && n.props.role === "note")[0]);
const statuses = (root) => find(root, (n) => n.type === "p" && n.props.role === "status").map(text);
const alerts = (root) => find(root, (n) => n.type === "p" && n.props.role === "alert").map(text);
const field = (root, label) => find(root, (n) => (n.type === "select" || n.type === "input") && n.props["aria-label"] === label)[0];
const startField = (root) => find(root, (n) => n.type === "input" && n.props.type === undefined && n.props["aria-label"] === undefined && /^\d*$/.test(String(n.props.value)) && n.props.style?.width === "9rem")[0];
const checkbox = (root) => find(root, (n) => n.type === "input" && n.props.type === "checkbox")[0];
const button = (root, label) => find(root, (n) => n.type === "button" && text(n).includes(label))[0];
const change = (node, value) => act(async () => { node.props.onChange({ target: { value, checked: value } }); });
const mount = async (element) => { let r; await act(async () => { r = TestRenderer.create(element); }); await settle(); return r; };

test("a reference without a stated location is placed by itself: three Ensembl requests, fields filled, confirmation left to the user", async () => {
  await withModules(async ({ picker, design }) => {
    const ens = fakeEnsembl(design);
    const r = await mount(React.createElement(picker.PmCandidatePicker, { project: { gene: "APOE", genbankRaw: UNLOCATED, options: OPTIONS, designResult: design }, result: design, onUseCandidate() {}, lookupFetch: ens.fetchImpl }));
    assert.equal(ens.log.length, 3); assert.ok(ens.log.every((u) => u.startsWith("https://rest.ensembl.org/")));
    assert.equal(field(r.root, "Chromosome").props.value, "19");
    assert.equal(String(startField(r.root).props.value), String(TRUE_START));
    assert.equal(checkbox(r.root).props.checked, false, "the mapping is proposed, never confirmed on the user's behalf");
    assert.match(note(r.root), /^Filled from Ensembl: APOE is on chromosome 19 \(GRCh38\) and the uploaded sequence starts at 44,905,754; it matches GRCh38 at all 3,640 bases\. Check the numbers, then tick the box\. Before running: tick \u201cI checked this mapping\u201d\.$/);
    await change(checkbox(r.root), true);
    assert.match(note(r.root), /Mapping ready: the helper checks it against GRCh38 before predicting/); assert.doesNotMatch(note(r.root), /Before running/);
    r.unmount();
  });
});

test("a reference that states its location is read, and nothing is looked up", async () => {
  await withModules(async ({ picker, design }) => {
    const ens = fakeEnsembl(design);
    const r = await mount(React.createElement(picker.PmCandidatePicker, { project: { gene: "APOE", genbankRaw: APOE, options: OPTIONS, designResult: design }, result: design, onUseCandidate() {}, lookupFetch: ens.fetchImpl }));
    assert.equal(ens.log.length, 0); assert.equal(field(r.root, "Chromosome").props.value, "19"); assert.equal(String(startField(r.root).props.value), String(TRUE_START));
    r.unmount();
  });
});

test("values typed while the lookup is still running are kept; Fill from design replaces them on request", async () => {
  await withModules(async ({ picker, design }) => {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const ens = fakeEnsembl(design, { gate });
    const r = await mount(React.createElement(picker.PmCandidatePicker, { project: { gene: "APOE", genbankRaw: UNLOCATED, options: OPTIONS, designResult: design }, result: design, onUseCandidate() {}, lookupFetch: ens.fetchImpl }));
    assert.match(note(r.root), /^Looking up where APOE sits in GRCh38 \(Ensembl\)/);
    assert.equal(button(r.root, "Fill from design").props.disabled, true, "one lookup at a time");
    await change(field(r.root, "Chromosome"), "5"); await change(startField(r.root), "1000");
    release(); await settle();
    assert.equal(field(r.root, "Chromosome").props.value, "5"); assert.equal(String(startField(r.root).props.value), "1000", "the automatic result did not overwrite typing");
    assert.doesNotMatch(note(r.root), /Filled from Ensembl/, "and the page does not claim the fields came from Ensembl");
    await act(async () => { await button(r.root, "Fill from design").props.onClick(); }); await settle();
    assert.equal(field(r.root, "Chromosome").props.value, "19"); assert.equal(String(startField(r.root).props.value), String(TRUE_START));
    assert.match(note(r.root), /^Filled from Ensembl/);
    await change(startField(r.root), String(TRUE_START + 5));
    assert.doesNotMatch(note(r.root), /Filled from Ensembl/, "editing a filled value takes the claim away");
    r.unmount();
  });
});

test("a different reference discards the old mapping and its confirmation, and an answer that arrives late is ignored", async () => {
  await withModules(async ({ picker, design }) => {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const ens = fakeEnsembl(design, { gate });
    const at = (genbankRaw) => React.createElement(picker.PmCandidatePicker, { project: { gene: "APOE", genbankRaw, options: OPTIONS, designResult: design }, result: design, onUseCandidate() {}, lookupFetch: ens.fetchImpl });
    const r = await mount(at(UNLOCATED));                         // lookup in flight
    await act(async () => { r.update(at(APOE)); }); await settle(); // the user loads a record that states its location
    assert.equal(field(r.root, "Chromosome").props.value, "19"); assert.equal(String(startField(r.root).props.value), String(TRUE_START));
    await change(checkbox(r.root), true); assert.equal(checkbox(r.root).props.checked, true);
    release(); await settle();                                    // the stale answer lands
    assert.equal(checkbox(r.root).props.checked, true, "a stale lookup did not reset anything");
    assert.doesNotMatch(note(r.root), /Filled from Ensembl/);
    // loading yet another record (no location) clears the confirmation and the fields
    const other = UNLOCATED.replace("APOE", "APOE ");
    await act(async () => { r.update(at(other)); }); await settle();
    assert.equal(checkbox(r.root).props.checked, false, "a new reference needs a new confirmation");
    r.unmount();
  });
});

test("a lookup that cannot place the reference says why and leaves the fields empty", async () => {
  await withModules(async ({ picker, design }) => {
    const down = async () => { throw new TypeError("Failed to fetch"); };
    const r = await mount(React.createElement(picker.PmCandidatePicker, { project: { gene: "APOE", genbankRaw: UNLOCATED, options: OPTIONS, designResult: design }, result: design, onUseCandidate() {}, lookupFetch: down }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3000)); }); // the resolver waits between its three attempts
    assert.match(note(r.root), /^Bench could not place this reference automatically: Ensembl could not be reached\. Check the connection, or enter the position by hand\. Before running: select the chromosome; enter the GRCh38 position/);
    assert.equal(field(r.root, "Chromosome").props.value, ""); assert.equal(String(startField(r.root).props.value), "");
    r.unmount();
  });
});

function fakeHelper(report, { token = "code-123", status = null } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, method: init?.method, token: init?.headers?.["X-Assured-Token"], body: init?.body });
    if (status) return reply(status.code, { error: status.error, code: status.name });
    if (url.endsWith("/health")) return reply(200, { status: "ok", schema: "assured-alphagenome-helper/1", keyConfigured: true, sdkVersion: "0.10.0", nullsCached: 1 });
    if (init.headers["X-Assured-Token"] !== token) return reply(401, { error: "x", code: "bad-token" });
    const request = JSON.parse(init.body); const copy = JSON.parse(JSON.stringify(report)); copy.requestId = request.requestId;
    return reply(200, copy);
  };
  fetchFn.calls = calls; return fetchFn;
}
const mountForHelper = (picker, design, helperFetch) => mount(React.createElement(picker.PmCandidatePicker, { project: { gene: "APOE", genbankRaw: APOE, options: OPTIONS, designResult: design }, result: design, onUseCandidate() {}, helperFetch }));
/** The two cell-context lists, primary first (the chromosome list carries an aria-label, these do not). */
const contexts = (root) => find(root, (n) => n.type === "select" && !n.props["aria-label"]);

test("one click: check connection, run through the helper, and the ranking appears; the code travels only in its header", async () => {
  await withModules(async ({ picker, design }) => {
    const report = JSON.parse(read("./fixtures/alphagenome-ranking/apoe-r176c-report.json"));
    const helper = fakeHelper(report);
    const r = await mountForHelper(picker, design, helper);
    await change(contexts(r.root)[0], "glutamatergic-neuron"); // primary context: neuron; second: WTC11 (the saved report holds both)
    await change(contexts(r.root)[1], "wtc11");
    await change(checkbox(r.root), true); await change(field(r.root, "Session code"), "code-123");
    await act(async () => { await button(r.root, "Check connection").props.onClick(); }); await settle();
    assert.ok(statuses(r.root).includes("Helper connected; AlphaGenome key configured; SDK 0.10.0; 1 null cached."));
    await act(async () => { await button(r.root, "Run AlphaGenome comparison").props.onClick(); }); await settle();
    const rank = helper.calls.find((c) => c.url.endsWith("/rank"));
    assert.equal(rank.method, "POST"); assert.equal(rank.token, "code-123"); assert.ok(!rank.body.includes("code-123"));
    assert.ok(statuses(r.root).some((s) => /^Equally supported among 4 candidates evaluated in Glutamatergic neuron: Candidate 1 and Candidate 2\.$/.test(s)));
    assert.ok(statuses(r.root).some((s) => /^Comparison finished at .*; the report was checked against this request and ranked below\.$/.test(s)));
    assert.deepEqual(alerts(r.root), []);
    assert.equal(button(r.root, "Run AlphaGenome comparison").props.disabled, false, "can be run again");
    r.unmount();
  });
});

test("one click: a wrong code, a busy helper and an unconfirmed mapping each stop with a message that says what to do", async () => {
  await withModules(async ({ picker, design }) => {
    const report = JSON.parse(read("./fixtures/alphagenome-ranking/apoe-r176c-report.json"));
    const helper = fakeHelper(report);
    const r = await mountForHelper(picker, design, helper);
    await change(contexts(r.root)[0], "glutamatergic-neuron");
    await change(field(r.root, "Session code"), "code-123");
    await act(async () => { await button(r.root, "Run AlphaGenome comparison").props.onClick(); }); await settle();
    assert.match(alerts(r.root)[0], /^Confirm the assembly and genomic mapping/); assert.equal(helper.calls.length, 0, "nothing was sent without the confirmation");
    await change(checkbox(r.root), true); await change(field(r.root, "Session code"), "wrong");
    await act(async () => { await button(r.root, "Run AlphaGenome comparison").props.onClick(); }); await settle();
    assert.match(alerts(r.root)[0], /session code is missing or wrong\. Copy it from the terminal/);
    r.unmount();
    const busy = await mountForHelper(picker, design, fakeHelper(report, { status: { code: 409, name: "busy", error: "x" } }));
    await change(contexts(busy.root)[0], "glutamatergic-neuron");
    await change(checkbox(busy.root), true); await change(field(busy.root, "Session code"), "code-123");
    await act(async () => { await button(busy.root, "Run AlphaGenome comparison").props.onClick(); }); await settle();
    assert.match(alerts(busy.root)[0], /already running a comparison/);
    busy.unmount();
  });
});
