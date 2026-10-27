/**
 * The older single-donor AlphaGenome review panel (Analysis & evidence page) with the position lookup, run as a component.
 * Ensembl is replaced by a stand-in whose "genome" is the bundled reference placed at the position the real Ensembl gave for it
 * (checked live: APOE chr19:44905754 forward; TP53 NG_017013.2 chr17:7659779-7692550, reverse complement of the chromosome).
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
const TP53 = read("../public/references/tp53-NG_017013.2.gb");
const rc = (seq) => [...seq].reverse().map((b) => ({ A: "T", C: "G", G: "C", T: "A", N: "N" }[b])).join("");
const OPTS = (gene) => ({ deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: gene });

async function withModules(fn) {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const engine = await vite.ssrLoadModule("/src/engine/design/designEngine.js");
    const panel = await vite.ssrLoadModule("/src/components/design/AlphaGenomeReview.jsx");
    const service = await vite.ssrLoadModule("/src/services/alphaGenomeReview.js");
    return await fn({ engine, panel, service });
  } finally { await vite.close(); }
}
const reply = (status, json, text) => ({ status, ok: status >= 200 && status < 300, json: async () => json, text: async () => text });
function fakeEnsembl({ genome, origin, gene, gate = null }) {
  const log = [];
  const fetchImpl = async (url) => {
    log.push(url); if (gate) await gate;
    if (url.includes("/lookup/")) return reply(200, { object_type: "Gene", assembly_name: "GRCh38", ...gene });
    const m = /:(\d+)\.\.(\d+):1/.exec(url); const a = Number(m[1]), b = Number(m[2]);
    if (a < origin || b >= origin + genome.length) return reply(400, {});
    return reply(200, null, genome.slice(a - origin, b - origin + 1));
  };
  return { fetchImpl, log };
}
const text = (node) => (node.children || []).map((c) => (typeof c === "string" ? c : text(c))).join("");
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 4)); }); };
const find = (root, pred) => root.findAll(pred);
const chromosome = (root) => find(root, (n) => n.type === "select" && n.props["aria-label"] === "AlphaGenome chromosome")[0];
const startInput = (root) => find(root, (n) => n.type === "input" && n.props.type === "number")[0];
const orientation = (root) => find(root, (n) => n.type === "select" && n.findAll((o) => o.type === "option" && o.props.value === "-1").length > 0)[0];
const confirmBox = (root) => find(root, (n) => n.type === "input" && n.props.type === "checkbox")[0];
const note = (root) => text(find(root, (n) => n.type === "p" && n.props.role === "note")[0]);
const button = (root, label) => find(root, (n) => n.type === "button" && text(n).includes(label))[0];
const change = (node, value) => act(async () => { node.props.onChange({ target: { value, checked: value } }); });
const mount = async (element) => { let r; await act(async () => { r = TestRenderer.create(element); }); await settle(); return r; };

test("APOE R176C without a stated location: chromosome 19, start 44,905,754, orientation +1 are filled; the request puts the edit at rs7412 (chr19:44908822 C>T)", async () => {
  await withModules(async ({ engine, panel, service }) => {
    const design = engine.runDesign("pm", APOE.replace(/GRCh38[\s\S]{0,120}?Location:\s*chr\d+\s+\d+-\d+/i, "location not stated"), "R176C", "", 400, OPTS("APOE"));
    assert.equal(design.err, undefined);
    const project = { id: "p-apoe", gene: "APOE", genbankRaw: "no location here", designResult: design };
    assert.equal(service.intendedEditIndex(project), 3068, "the intended base, found from the design");
    const genome = design.gb.genomicSequence;
    const ens = fakeEnsembl({ genome, origin: 44905754, gene: { id: "ENSG00000130203", display_name: "APOE", seq_region_name: "19", strand: 1, start: 44905754 + 700, end: 44905754 + genome.length - 500 } });
    const r = await mount(React.createElement(panel.AlphaGenomeReview, { project, lookupFetch: ens.fetchImpl }));
    assert.equal(ens.log.length, 3);
    assert.equal(chromosome(r.root).props.value, "19"); assert.equal(String(startInput(r.root).props.value), "44905754"); assert.equal(String(orientation(r.root).props.value), "1");
    assert.equal(confirmBox(r.root).props.checked, false);
    assert.match(note(r.root), /^Filled from Ensembl: APOE is on chromosome 19 \(GRCh38\) and the uploaded sequence starts at 44,905,754; it matches GRCh38 at all 3,640 bases\. Check the numbers, then tick the box\. Before exporting: tick the confirmation\.$/);
    assert.equal(button(r.root, "1. Export review request").props.disabled, true, "export stays off until the mapping is confirmed");
    await change(confirmBox(r.root), true);
    assert.equal(button(r.root, "1. Export review request").props.disabled, false);
    assert.match(note(r.root), /Mapping ready: the review tool checks it against GRCh38/);
    const request = await service.buildAlphaGenomeRequest({ ...project, genbankRaw: "" }, { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: 1, ontologyTerm: "CL:0000679", mappingConfirmed: true });
    const intended = request.variants.find((v) => v.role === "intended");
    assert.deepEqual([intended.position, intended.ref, intended.alt], [44908822, "C", "T"], "rs7412, NC_000019.10:g.44908822C>T");
    r.unmount();
  });
});

test("TP53 R175H in the RefSeqGene record (written on the opposite strand): chr17 start 7,659,779, orientation \u22121, and the request puts the edit at rs28934578 (chr17:7675088 C>T)", async () => {
  await withModules(async ({ engine, panel, service }) => {
    const design = engine.runDesign("pm", TP53, "R175H", "", 400, OPTS("TP53"));
    assert.equal(design.err, undefined);
    const project = { id: "p-tp53", gene: "TP53", genbankRaw: TP53, designResult: design };
    assert.equal(service.alphaGenomeMapping(project), null, "the record states no chromosome location");
    assert.equal(service.intendedEditIndex(project), 17462, "NG_017013.2:g.17463 (1-based), the position dbSNP and ClinVar give for c.524G>A");
    const record = design.gb.genomicSequence; assert.equal(record.length, 32772);
    // the chromosome in this stand-in is the forward strand: the reverse complement of the record, placed at the true start
    const ens = fakeEnsembl({ genome: rc(record), origin: 7659779, gene: { id: "ENSG00000141510", display_name: "TP53", seq_region_name: "17", strand: -1, start: 7661779, end: 7687546 } });
    const r = await mount(React.createElement(panel.AlphaGenomeReview, { project, lookupFetch: ens.fetchImpl }));
    assert.equal(chromosome(r.root).props.value, "17"); assert.equal(String(startInput(r.root).props.value), "7659779"); assert.equal(String(orientation(r.root).props.value), "-1");
    assert.match(note(r.root), /^Filled from Ensembl: TP53 is on chromosome 17 \(GRCh38\) and the uploaded sequence is written on the opposite strand \(reverse complement of the chromosome\) and covers chromosome positions from 7,659,779; it matches GRCh38 at all 32,772 bases\./);
    // what the filled values mean downstream, against coordinates from dbSNP/ClinVar rather than from this code
    const request = await service.buildAlphaGenomeRequest(project, { assembly: "GRCh38", chromosome: "17", referenceStart: 7659779, orientation: -1, ontologyTerm: "CL:0000679", mappingConfirmed: true });
    const intended = request.variants.find((v) => v.role === "intended");
    assert.deepEqual([intended.position, intended.ref, intended.alt], [7675088, "C", "T"]);
    r.unmount();
  });
});

test("a record that states its location is read, not looked up; typed values survive the automatic lookup; Fill from design replaces them; failures are explained", async () => {
  await withModules(async ({ engine, panel }) => {
    const stated = APOE.replace(/GRCh38[\s\S]{0,120}?Location:\s*chr\d+\s+\d+-\d+/i, "Location: chromosome:GRCh38:19:44905754:44909393:1");
    const design = engine.runDesign("pm", stated, "R176C", "", 400, OPTS("APOE"));
    const genome = design.gb.genomicSequence;
    const gene = { id: "ENSG00000130203", display_name: "APOE", seq_region_name: "19", strand: 1, start: 44905754 + 700, end: 44905754 + genome.length - 500 };
    const ens = fakeEnsembl({ genome, origin: 44905754, gene });
    const located = await mount(React.createElement(panel.AlphaGenomeReview, { project: { id: "a", gene: "APOE", genbankRaw: stated, designResult: design }, lookupFetch: ens.fetchImpl }));
    assert.equal(ens.log.length, 0, "nothing is looked up when the record states where it sits");
    assert.equal(chromosome(located.root).props.value, "19"); assert.equal(String(startInput(located.root).props.value), "44905754");
    located.unmount();

    const unlocated = { id: "b", gene: "APOE", genbankRaw: "no location", designResult: design };
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const slow = fakeEnsembl({ genome, origin: 44905754, gene, gate });
    const r = await mount(React.createElement(panel.AlphaGenomeReview, { project: unlocated, lookupFetch: slow.fetchImpl }));
    assert.match(note(r.root), /^Looking up where APOE sits in GRCh38 \(Ensembl\)/);
    assert.equal(button(r.root, "Fill from design").props.disabled, true);
    await change(chromosome(r.root), "5"); await change(startInput(r.root), "1000");
    release(); await settle();
    assert.equal(chromosome(r.root).props.value, "5"); assert.equal(String(startInput(r.root).props.value), "1000", "typing was not overwritten");
    assert.doesNotMatch(note(r.root), /Filled from Ensembl/);
    await act(async () => { await button(r.root, "Fill from design").props.onClick(); }); await settle();
    assert.equal(chromosome(r.root).props.value, "19"); assert.equal(String(startInput(r.root).props.value), "44905754");
    r.unmount();

    const bad = fakeEnsembl({ genome, origin: 44905754, gene: { ...gene, assembly_name: "GRCh37" } });
    const refused = await mount(React.createElement(panel.AlphaGenomeReview, { project: unlocated, lookupFetch: async (u) => { const out = await bad.fetchImpl(u); if (u.includes("/lookup/")) return reply(200, { object_type: "Gene", ...gene, assembly_name: "GRCh37" }); return out; } }));
    assert.match(note(refused.root), /^Bench could not place this reference automatically: Ensembl reports APOE on GRCh37; this tool uses GRCh38\. Before exporting: select the chromosome; enter the GRCh38 position \(1-based\) of the first base of the uploaded sequence; choose the orientation; tick the confirmation\.$/);
    assert.equal(chromosome(refused.root).props.value, "");
    refused.unmount();
  });
});
