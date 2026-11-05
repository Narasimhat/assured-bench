// Trace quality where the call is made (cut +/- 150 bases and the fit's own stretch), and what it changes: "repeat the read" only for a poor trace, "look at the chromatogram" for a clean trace the fit could not settle.
// Everything is simulated (traces built from allele sequences); no laboratory trace is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyseSample } from "../src/engine/qc/batch.js";
import { decide } from "../src/engine/qc/decision.js";
import { withRecommendations } from "../src/engine/qc/recommend.js";
import { buildQcReportHtml } from "../src/engine/qc/report.js";
import { reverseComplement as rc } from "../src/engine/qc/seq.js";
import { synthTrace, substitute } from "./helpers/synthetic-trace.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/qc-clone-flags/apoe_r176c_snp.design.json", import.meta.url), "utf8"));
const reference = spec.reference.sequence.toUpperCase();
const donor = spec.donors[0];
const edited = reference.slice(0, donor.refStart) + donor.sequence.toUpperCase() + reference.slice(donor.refEnd); // the intended allele (ssODN1)
// The forward read starts after the forward primer (318); the reverse read starts at the reverse primer (751) and runs down.
const forward = (sequence) => sequence.slice(318, 318 + 560);
const reverse = (sequence) => rc(sequence.slice(0, 752)).slice(0, 520);
const trace = (alleles, direction, extra = {}) => synthTrace(alleles.map((a) => ({ sequence: (direction === "F" ? forward : reverse)(a.sequence), share: a.share })), { name: `sim-${direction}`, ...extra });
const controlF = trace([{ sequence: reference, share: 1 }], "F");
const controlR = trace([{ sequence: reference, share: 1 }], "R");
const NONSENSE = { position: 503, alt: "T" };   // AAG > TAG, K164* in the design's reading frame, 32 bases upstream of the first cut
const MISSENSE = { position: 471, alt: "A" };   // V153E
const SILENT = { position: 472, alt: "A" };     // V153V

/** A clone: its alleles read from both ends (or from one), analysed and decided as the app does. */
function clone(alleles, { reads = ["F", "R"], noise = 0, workflow = "snp", options = {} } = {}) {
  const controlOf = (d) => (d === "F" ? controlF : controlR);
  const traces = reads.map((d, i) => ({ name: i ? `read ${i + 1}` : "read 1", control: noise ? trace([{ sequence: reference, share: 1 }], d, { noise, seed: 3 }) : controlOf(d), edited: trace(alleles, d, noise ? { noise, seed: 11 } : {}) }));
  const result = analyseSample({ name: "clone", spec, control: traces[0].control, edited: traces[0].edited, extraReads: traces.slice(1), sampleType: "clone", options });
  assert.ok(result.ok, result.error);
  return { ...result, workflow, decision: decide(workflow, result) };
}
const hom = (...changes) => [{ sequence: changes.length ? substitute(edited, changes.map((c) => ({ pos: c.position, alt: c.alt }))) : edited, share: 1 }];
import { traceQualityOf, traceQualityOfReads } from "../src/engine/qc/traceQuality.js";
import { actionRows } from "../src/engine/qc/actions.js";

const visible = (html) => html.split("<details")[0];
const good = Array(600).fill(60);
const pair = (editedQ, controlQ = good, extra = {}) => ({ edited: { quality: editedQ }, control: { quality: controlQ }, shift: 0, shiftPivot: 0, shiftUp: 0, firstCut: 200, lastCut: 200, window: { start: 175, end: 350 }, ...extra });
const poorAt = (from, to) => good.map((q, i) => (i >= from && i <= to ? 10 : q));

test("the quality windows follow the cut: poor bases far from the cut do not count, poor bases next to it do", () => {
  const far = traceQualityOf(pair(good.map((q, i) => (i < 50 || i > 350 ? 10 : q))));
  assert.equal(far.edited.cut.q20, 1); assert.equal(far.poor, false); assert.deepEqual(far.why, []);
  const near = traceQualityOf(pair(poorAt(300, 350)));
  assert.equal(near.edited.cut.n, 301); assert.equal(near.edited.fit.n, 176);
  assert.ok(Math.abs(near.edited.cut.q20 - 250 / 301) < 0.001); assert.ok(Math.abs(near.edited.fit.q20 - 125 / 176) < 0.001);
  assert.equal(near.q20, near.edited.fit.q20, "the headline is the lower of the two windows");
  assert.equal(near.poor, true); assert.match(near.why[0], /only 71% of the edited trace's bases around the cut are Q20 or better/);
});

test("the edited read is mapped onto the control's coordinates by the same shift the fit uses", () => {
  const shifted = traceQualityOf(pair(poorAt(305, 355), good, { shift: 5 }));
  assert.equal(shifted.poor, true);
  const unshifted = traceQualityOf(pair(poorAt(305, 355)));
  assert.ok(shifted.edited.fit.q20 < unshifted.edited.fit.q20, "the same poor stretch lies further inside the window once the shift is applied");
});

test("a poor control is reported as such", () => {
  const r = traceQualityOf(pair(good, poorAt(200, 330)));
  assert.equal(r.poor, true); assert.match(r.why.join(" "), /control trace/); assert.equal(r.edited.cut.q20, 1);
});

test("a clone with several reads is judged by its best read, and each read is kept", () => {
  const r = traceQualityOfReads([pair(poorAt(200, 340)), pair(good)]);
  assert.equal(r.poor, false); assert.equal(r.reads.length, 2);
  assert.equal(traceQualityOfReads([pair(good)]).reads, undefined);
});

test("the engine reports it for a simulated clone", () => {
  const r = analyseSample({ name: "c", spec, control: controlF, edited: trace([{ sequence: edited, share: 1 }], "F"), sampleType: "clone", options: {} });
  assert.ok(r.ok, r.error);
  assert.equal(r.traceQuality.poor, false); assert.equal(r.traceQuality.q20, 1); assert.equal(r.traceQuality.flank, 150);
});

/** A clone the fit could not settle, with the trace quality given. */
const unresolved = (name, traceQuality, extra = {}) => {
  const base = analyseSample({ name, spec, control: controlF, edited: trace([{ sequence: edited, share: 1 }], "F"), sampleType: "clone", options: {} });
  return { ...base, name, workflow: "snp", confidence: { tier: "low", width: 60 }, intervals: { ...base.intervals, editedPct: [30, 100] }, quality: { ...base.quality, r2: 0.4 }, traceQuality,
    decision: { decision: "re-sequence", reasons: ["not precise"], next: "x" }, recommendation: { priority: "resequence" }, ...extra };
};
const clean = { flank: 150, q20: 0.98, controlQ20: 1, poor: false, why: [], edited: { cut: { q20: 0.99 }, fit: { q20: 0.98 } }, control: { cut: { q20: 1 }, fit: { q20: 1 } } };
const poorTrace = { ...clean, q20: 0.49, poor: true, why: ["only 49% of the edited trace's bases around the cut are Q20 or better"], edited: { cut: { q20: 0.53 }, fit: { q20: 0.49 } } };
const actionOf = (r) => actionRows("snp", [r]).rows[0];

test("a clean trace the fit could not settle is 'look at the chromatogram', not 'repeat the read'", () => {
  const row = actionOf(unresolved("x_Cl_1_A", clean));
  assert.equal(row.key, "inspect");
  assert.match(row.why, /Clean trace \(98% of its bases around the cut are Q20 or better\)/);
  assert.match(row.why, /95% interval 30-100%/);
  assert.match(row.why, /allele library explains only 40% of the signal\./);
});

test("a poor trace, a poor control, disagreeing reads or too little readable sequence are 'repeat the read'", () => {
  const poor = actionOf(unresolved("x_Cl_2_A", poorTrace));
  assert.equal(poor.key, "repeat"); assert.match(poor.why, /^Only 49% of the edited trace's bases/);
  const disagree = actionOf(unresolved("x_Cl_3_A", clean, { confidence: { tier: "moderate", width: 10 }, unwanted: { flags: [{ code: "reads-disagree", severity: "review", text: "x" }] } }));
  assert.equal(disagree.key, "repeat"); assert.match(disagree.why, /reads disagree/);
  const short = actionOf(unresolved("x_Cl_4_A", clean, { confidence: { tier: "moderate", width: 10 }, warnings: ["Only 12 readable bases lie downstream of the last cut; large deletions"] }));
  assert.equal(short.key, "repeat"); assert.match(short.why, /Too little readable sequence/);
});

test("without trace-quality numbers (results saved before they were measured) the old rule applies", () => {
  assert.equal(actionOf(unresolved("x_Cl_5_A", undefined)).key, "repeat");
});

test("many differing positions on a clean trace are 'look at the chromatogram'; on a poor trace 'repeat the read'", () => {
  const many = { confidence: { tier: "moderate", width: 10 }, unwanted: { flags: [{ code: "many-differences", severity: "review", text: "x" }] } };
  assert.equal(actionOf(unresolved("x_Cl_6_A", clean, many)).key, "inspect");
  assert.equal(actionOf(unresolved("x_Cl_7_A", poorTrace, many)).key, "repeat");
});

test("the report shows the trace quality, marks a poor one, and says 'Unresolved' where it used to say 'Sequence again'", () => {
  const results = withRecommendations([unresolved("x_Cl_1_A", clean), unresolved("x_Cl_2_A", poorTrace)], {});
  const html = buildQcReportHtml({ workflow: "snp", results });
  assert.match(visible(html), /<th class="num"[^>]*>Trace Q20 %<\/th>/);
  assert.match(html, /<td class="num warn" title="Edited trace: 53% Q20 or better within 150 bases of the cut, 49% in the stretch the fit uses[^"]*">49<\/td>/);
  assert.match(html, /<td class="num" title="[^"]*">98<\/td>/);
  assert.match(visible(html), /Look at the chromatogram/); assert.match(visible(html), /Repeat the read/);
  assert.doesNotMatch(html, /Sequence again/);
  assert.match(visible(html), /2 samples unresolved/);
});
