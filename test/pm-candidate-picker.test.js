import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const APOE = read("../public/references/apoe-ensg00000130203.gb");
const OPTIONS = { enzyme: "spcas9", deliveryMethod: "rnp", maxBlockingChanges: 3, expectedGene: "APOE" };

async function withModules(fn) {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true }, logLevel: "error" });
  try {
    const load = (p) => vite.ssrLoadModule(p);
    return await fn({ engine: await load("/src/engine/design/designEngine.js"), cand: await load("/src/engine/design/pmCandidates.js"), rank: await load("/src/services/candidateRanking.js"), picker: await load("/src/components/design/PmCandidatePicker.jsx") });
  } finally { await vite.close(); }
}
const project = (design) => ({ gene: "APOE", genbankRaw: APOE, options: OPTIONS, designResult: design });
const rankingFor = async ({ cand, rank }, design) => {
  const set = design.pmCandidates;
  const setup = await rank.buildCandidateRankingRequest(project(design), set, { contexts: ["glutamatergic-neuron", "wtc11"], mappingConfirmed: true, mapping: { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: 1 } });
  const report = JSON.parse(read("./fixtures/alphagenome-ranking/apoe-r176c-report.json")); report.requestId = setup.request.requestId;
  return rank.rankCandidates(set, { ...setup, report });
};

test("without a regulatory report the picker lists the pairs that passed, states what was not assessed, and recommends nothing", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const html = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(design), result: design, onUseCandidate() {} }));
    assert.match(html, /Matched guide \+ donor pairs/);
    assert.match(html, /4 pairs passed the core design checks out of 28 guide and donor versions considered within 30 bp/);
    assert.match(html, /Best tier at the design checks: Candidate 1 and Candidate 2\. No regulatory comparison has been run\./);
    assert.match(html, /Not assessed:<\/strong> genome-wide specificity for every pair/);
    for (const spacer of ["CGATGACCTGCAGAAGCGCC", "CCCCGGCCTGGTACACTGCC"]) assert.ok(html.includes(spacer), spacer);
    assert.match(html, /Show 2 alternatives and why they ranked lower/);
    assert.doesNotMatch(html, /ACACTGCCAGGCGCTTCTGC/, "alternatives stay collapsed by default");
    assert.doesNotMatch(html, /Best-supported|Equally supported/);
    assert.equal((html.match(/>Not run</g) || []).length, 2, "two top-tier rows shown, regulatory status not run");
    assert.match(html, /Regulatory comparison with AlphaGenome \(research use\)/);
    assert.match(html, /never enters the browser/);
    assert.match(html, /value="19"/); assert.match(html, /value="44905754"/, "the Ensembl-style location line prefills the mapping, unconfirmed");
  });
});

test("with an imported ranking the wording is a tie, the alternatives open with reasons, and the excluded versions say which check failed", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const ranking = await rankingFor(m, design);
    const html = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(design), result: design, onUseCandidate() {}, initialRanking: ranking, defaultShowAlternatives: true, defaultShowExcluded: true }));
    assert.match(html, /Equally supported among 4 candidates evaluated in Glutamatergic neuron: Candidate 1 and Candidate 2\./);
    assert.equal((html.match(/>Equally supported</g) || []).length, 2);
    assert.match(html, /ACACTGCCAGGCGCTTCTGC/);
    assert.match(html, /<strong>Candidate 3<\/strong>: [^<]*3 blocking changes against 2/);
    assert.match(html, /<strong>Candidate 4<\/strong>: [^<]*one spacer mismatch with the PAM intact/);
    assert.match(html, /The model did not separate any pair from random silent changes\./);
    assert.match(html, /If one pair must be ordered first, a practical convention, not regulatory evidence:/);
    assert.match(html, /24 versions that did not pass|Hide 24 version/);
    assert.match(html, /failed donor arm/); assert.match(html, /failed GC limits/); assert.match(html, /failed re-cut protection/);
    assert.doesNotMatch(html, /Best-supported among/);
  });
});

test("the applied pair is marked in use, and a model flag shows as flagged with its p value", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const lead = design.pmCandidates.candidates[1]; // second donor version of a guide: needs the avoid-positions option to reproduce
    const applied = m.cand.designWithCandidates(APOE, "R176C", m.cand.candidateDesignOptions(OPTIONS, lead));
    const inUse = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(applied), result: applied, onUseCandidate() {}, defaultShowAlternatives: true }));
    assert.equal((inUse.match(/In use/g) || []).length, 1);
    // Perturbed copy of the saved report (synthetic): the first candidate departs from the null.
    const setup = await m.rank.buildCandidateRankingRequest(project(design), design.pmCandidates, { contexts: ["glutamatergic-neuron"], mappingConfirmed: true, mapping: { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: 1 } });
    const report = JSON.parse(read("./fixtures/alphagenome-ranking/apoe-r176c-report.json")); report.requestId = setup.request.requestId;
    report.alleles[0].metrics["M1_expr_log2|CL:0000679"] = 1e3;
    // A one-context request has a smaller metric set; the fixture carries both contexts, so keep the two-context request for validation.
    const two = await m.rank.buildCandidateRankingRequest(project(design), design.pmCandidates, { contexts: ["glutamatergic-neuron", "wtc11"], mappingConfirmed: true, mapping: { assembly: "GRCh38", chromosome: "19", referenceStart: 44905754, orientation: 1 } });
    report.requestId = two.request.requestId;
    const ranking = m.rank.rankCandidates(design.pmCandidates, { ...two, report });
    const html = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(design), result: design, onUseCandidate() {}, initialRanking: ranking, defaultShowAlternatives: true }));
    assert.match(html, /Best-supported among 4 candidates evaluated in Glutamatergic neuron: Candidate 2\./);
    assert.match(html, /Flagged \(p 0\.03\)/);
    assert.match(html, /AlphaGenome flagged it against the null/);
  });
});

test("the picker is offered for SpCas9 point-mutation designs only, and its entry points are wired", () => {
  const view = read("../src/components/design/DesignResultView.jsx");
  assert.match(view, /result\.type === "pm" && \(!project\.options\?\.enzyme \|\| project\.options\.enzyme === "spcas9"\)/);
  assert.match(view, /hasPmCandidates && <PmCandidatePicker/);
  const design = read("../src/components/design/DesignView.jsx");
  assert.match(design, /executeDesign\(\[candidate\.guide\.sp\], \{ avoidBlockerPositions/);
  assert.match(design, /onUseCandidate=\{handleUseCandidate\}/);
  assert.match(read("../src/services/runOptions.js"), /PER_RUN_KEYS = \["customGuides", "avoidBlockerPositions"\]/);
});

test("one-click AlphaGenome: the helper controls are on the page, nothing is contacted on render, and the manual route stays available", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const contacted = [];
    const helperFetch = async (...args) => { contacted.push(args); throw new Error("must not be called on render"); };
    const html = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(design), result: design, onUseCandidate() {}, helperFetch }));
    assert.equal(contacted.length, 0, "rendering never touches the local helper");
    assert.match(html, /Run the comparison here/);
    assert.match(html, /python3 tools\/alphagenome\/rank\.py --serve/);
    assert.match(html, /aria-label="Helper address"[^>]*value="http:\/\/127\.0\.0\.1:18765"/);
    assert.match(html, /aria-label="Session code" type="password" autoComplete="off"/);
    assert.match(html, /Check connection/); assert.match(html, /Run AlphaGenome comparison/);
    assert.match(html, /Not connected yet\. Nothing is sent until you click\./);
    assert.match(html, /the sequence windows go from your computer to Google/);
    assert.match(html, /No helper: export the request and import the report by hand/); assert.match(html, /Export request/); assert.match(html, /Import report/);
    assert.match(html, /never enters the browser/);
  });
});

test("one-click AlphaGenome: connection, running and finished states say what is happening", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const render = (initialHelper) => renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(design), result: design, onUseCandidate() {}, initialHelper }));
    assert.match(render({ state: { status: "ok", health: { keyConfigured: true, sdkVersion: "0.10.0", nullsCached: 1 } } }), /Helper connected; AlphaGenome key configured; SDK 0\.10\.0; 1 null cached\./);
    assert.match(render({ state: { status: "ok", health: { keyConfigured: false, nullsCached: 0 } } }), /no AlphaGenome key configured on that computer; 0 nulls cached/);
    assert.match(render({ state: { status: "down", message: "The helper could not be reached at http://127.0.0.1:18765." } }), /could not be reached at http:\/\/127\.0\.0\.1:18765/);
    const running = render({ state: { status: "running" } });
    assert.match(running, /first comparison for a locus also builds the null/); assert.match(running, /Keep the helper&#x27;s terminal open/);
    assert.match(running, /<button[^>]*disabled=""[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?\s*Run AlphaGenome comparison/s, "cannot be started twice");
    assert.match(render({ state: { status: "done", finishedAt: "10:42:07" } }), /Comparison finished at 10:42:07; the report was checked against this request and ranked below\./);
    assert.match(render({ settings: { url: "http://localhost:9001", token: "abc" } }), /value="http:\/\/localhost:9001"/);
  });
});

test("the mapping fields say what is missing: a reference that names its location is prefilled, one that does not asks for the chromosome from a list", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const html = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: project(design), result: design, onUseCandidate() {} }));
    assert.match(html, /<select aria-label="Chromosome"[^>]*>.*<option value="19" selected="">19<\/option>/s, "chromosome 19 is read from the reference and selected");
    assert.match(html, /Before running: tick \u201cI checked this mapping\u201d\./);
    assert.doesNotMatch(html, /could not read where this reference sits/);

    // The same record with its location line removed: nothing to prefill, so the page must say so and offer a list, not a bare text box.
    const unlocated = { ...project(design), genbankRaw: APOE.replace(/GRCh38[\s\S]{0,120}?Location:\s*chr\d+\s+\d+-\d+/i, "location not stated") };
    assert.ok(unlocated.genbankRaw !== APOE, "the test record really lost its location");
    const bare = renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: unlocated, result: design, onUseCandidate() {} }));
    assert.match(bare, /<option value="" selected="">Select\u2026<\/option>/);
    assert.match(bare, /Bench could not read where this reference sits in GRCh38\. Before running: select the chromosome; enter the GRCh38 position \(1-based\) of the first base of the uploaded sequence; tick \u201cI checked this mapping\u201d\./);
    for (const c of ["1", "22", "X", "Y"]) assert.match(bare, new RegExp(`<option value="${c}">${c}</option>`));
    assert.doesNotMatch(bare, /<option value="(?:23|24|M|MT)"/);
  });
});

test("autofill from the design: the lookup is offered, runs only for a reference that does not state its location, and its states are explained", async () => {
  await withModules(async (m) => {
    const design = m.cand.designWithCandidates(APOE, "R176C", OPTIONS);
    const unlocated = { ...project(design), genbankRaw: APOE.replace(/GRCh38[\s\S]{0,120}?Location:\s*chr\d+\s+\d+-\d+/i, "location not stated") };
    const calls = [];
    const lookupFetch = async (...a) => { calls.push(a); throw new Error("not on render"); };
    const render = (props, proj = unlocated) => renderToStaticMarkup(React.createElement(m.picker.PmCandidatePicker, { project: proj, result: design, onUseCandidate() {}, lookupFetch, ...props }));
    const base = render({});
    assert.equal(calls.length, 0, "rendering contacts nothing (the lookup starts after mount)");
    assert.match(base, /Fill from design/); assert.match(base, /Only the gene symbol and coordinates are sent/);

    const result = { ok: true, chromosome: "19", referenceStart: 44905754, referenceEnd: 44909393, assembly: "GRCh38", gene: { symbol: "APOE", id: "ENSG00000130203", start: 44903787, end: 44909396 }, comparison: { length: 3640, compared: 3640, mismatches: 0, identity: 1 } };
    const filled = render({ initialLookup: { status: "ok", result } });
    assert.match(filled, /<option value="19" selected="">19<\/option>/); assert.match(filled, /value="44905754"/);
    assert.match(filled, /Filled from Ensembl: APOE is on chromosome 19 \(GRCh38\) and the uploaded sequence starts at 44,905,754; it matches GRCh38 at all 3,640 bases\. Check the numbers, then tick the box\. Before running: tick \u201cI checked this mapping\u201d\./);
    assert.doesNotMatch(filled, /could not read where this reference sits/, "no complaint once the mapping is filled");

    assert.match(render({ initialLookup: { status: "running" } }), /Looking up where APOE sits in GRCh38 \(Ensembl\) and placing your sequence there\u2026/);
    const failed = render({ initialLookup: { status: "failed", message: "APOE is on the reverse strand." } });
    assert.match(failed, /Bench could not place this reference automatically: APOE is on the reverse strand\. Before running: select the chromosome; enter the GRCh38 position/);
    // a reference that states its own location is read, not looked up
    const stated = render({}, project(design));
    assert.match(stated, /<option value="19" selected="">19<\/option>/); assert.doesNotMatch(stated, /could not read|Filled from Ensembl/);
  });
});

test("the picker starts the lookup after mount only when the location is unreadable and a gene is known, and cancels it when the reference changes", () => {
  const source = read("../src/components/design/PmCandidatePicker.jsx");
  assert.match(source, /const lookupWanted = !detected && Boolean\(built && !built\.err && geneSymbol\);/);
  assert.match(source, /useEffect\(\(\) => \{ if \(lookupWanted\) runLookup\(\{ overwrite: false \}\); return \(\) => \{ lookupRun\.current \+= 1; \}; \}, \[project\?\.genbankRaw, lookupWanted\]\);/);
  assert.match(source, /if \(run !== lookupRun\.current\) return;/);
  assert.match(source, /\(overwrite \|\| \(!m\.chromosome && !m\.referenceStart\) \? \{ chromosome: out\.chromosome, referenceStart: out\.referenceStart, confirmed: false \} : m\)/, "an automatic result never overwrites what the user typed; the confirmation is never pre-ticked");
});
