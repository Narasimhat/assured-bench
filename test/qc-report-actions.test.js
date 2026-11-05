// The report's "what to do with each clone" table: what each engine call means in the lab, one row per clone, and a first page that does not repeat itself.
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
import { actionRows, ACTION, cloneLabel, nextAction, briefGenotype } from "../src/engine/qc/actions.js";

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


const named = (r, name) => ({ ...r, name });
const ranked = (list) => withRecommendations(list, {});
const visible = (html) => html.split("<details")[0];
const words = (html) => visible(html).replace(/<style>.*?<\/style>/s, "").replace(/<svg.*?<\/svg>/gs, " ").replace(/<[^>]+>/g, " ");

test("a clean clone is carried forward and a clone with a confirmed protein-changing base is discarded, with the base named", () => {
  const { rows } = actionRows("snp", ranked([named(clone(hom()), "good_Cl_1_A"), named(clone(hom(NONSENSE)), "bad_Cl_2_B")]));
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
  assert.equal(byLabel.cl1.key, "carry");
  assert.equal(byLabel.cl2.key, "discard");
  assert.match(byLabel.cl2.why, /K164\*/);
  assert.match(byLabel.cl2.why, /in 2 reads/);
});

test("the same base seen in one read of a clone that carries the edit is 'confirm a base', not 'sequence again'", () => {
  const { rows } = actionRows("snp", ranked([named(clone(hom(NONSENSE), { reads: ["F"] }), "x_Cl_3_A")]));
  assert.equal(rows[0].call, "re-sequence");
  assert.equal(rows[0].key, "confirm");
  assert.match(rows[0].why, /in one read only/);
});

test("a call the interval is too wide to make on a clean trace is 'look at the chromatogram'; a clear trace without the edit is 'not the intended edit'", () => {
  const base = clone(hom());
  const noisy = { ...base, name: "n_Cl_4_A", confidence: { tier: "low", width: 60 }, intervals: { ...base.intervals, editedPct: [40, 100] }, decision: { ...base.decision, decision: "re-sequence", reasons: ["not precise"] } };
  const indel = { ...base, name: "n_Cl_5_A", summary: { ...base.summary, intendedEditPct: 0 }, confidence: { tier: "high", width: 1 }, decision: { ...base.decision, decision: "re-sequence", reasons: ["x"] } };
  const { rows } = actionRows("snp", [noisy, indel].map((r) => ({ ...r, recommendation: { priority: "resequence" } })));
  assert.deepEqual(rows.map((row) => [row.label, row.key]), [["cl4", "inspect"], ["cl5", "other"]]);
  assert.match(rows[0].why, /95% interval 40-100%/);
});

test("a read that could not be analysed is folded into the row of the same clone, and stands alone when no read of the clone was analysed", () => {
  const ok = named(clone(hom()), "PHF6_S199E_Cl_9_1174_EF1");
  const failed = { name: "PHF6_S199E_Cl_9_1175_EF2", kind: "trace-pair", ok: false, error: "The edited trace does not align to the control", warnings: [], decision: { decision: "re-sequence", reasons: ["x"] } };
  const alone = { ...failed, name: "PHF6_S199E_Cl_4_1174_EF3" };
  const view = actionRows("snp", ranked([ok, failed, alone]));
  assert.equal(view.rows.length, 2);
  const nine = view.rows.find((row) => row.label === "cl9");
  assert.equal(nine.folded.length, 1);
  assert.equal(view.rows.find((row) => row.label === "cl4").key, "fix");
  assert.equal(view.labelOf.get("PHF6_S199E_Cl_9_1175_EF2"), "cl9");
});

test("names without a clone number keep their own rows", () => {
  assert.equal(cloneLabel("PHF6_S199E_Cl_12_1174_EF74878458"), "cl12");
  assert.equal(cloneLabel("cl9"), "cl9");
  assert.equal(cloneLabel("A01_sample"), null);
  const view = actionRows("snp", ranked([named(clone(hom()), "A01_sample"), named(clone(hom(NONSENSE)), "B02_sample")]));
  assert.deepEqual(view.rows.map((row) => row.label).sort(), ["A01_sample", "B02_sample"]);
});

test("the first page leads with the action table; the engine call is on hover and 'Sequence again' is not used anywhere", () => {
  const html = buildQcReportHtml({ workflow: "snp", results: ranked([named(clone(hom()), "x_Cl_1_A"), named(clone(hom(NONSENSE), { reads: ["F"] }), "x_Cl_2_A")]) });
  assert.match(visible(html), /What to do with each clone/);
  assert.doesNotMatch(html, /Sequence again/);
  assert.match(html, /title="Engine call: Unresolved"/);
  assert.match(visible(html), /Confirm a base/);
  assert.ok(visible(html).indexOf("What to do with each clone") < html.indexOf("Flagged changes in detail"));
});

test("flags are listed once per clone and the indel sentence once for the section", () => {
  const base = clone(hom());
  const twice = (name) => ({ ...base, name, decision: { ...base.decision, decision: "hold" }, unwanted: { ...base.unwanted, flags: [
    { code: "indel-at-cut", severity: "review", knockInOnly: true, text: "An indel allele sits next to the intended edit (a 10%): the clone is not a clean knock-in. An indel allele is a second, unplanned change at the cut; whether it matters depends on the gene (dosage, X-linkage)." },
    { code: "indel-at-cut", severity: "review", knockInOnly: true, text: "An indel allele sits next to the intended edit (b 12%): the clone is not a clean knock-in. An indel allele is a second, unplanned change at the cut; whether it matters depends on the gene (dosage, X-linkage)." }] } });
  const html = buildQcReportHtml({ workflow: "snp", results: ranked([twice("p_Cl_7_A"), twice("p_Cl_8_A")]) });
  const section = html.slice(html.indexOf("Flagged changes in detail"), html.indexOf("</details>", html.indexOf("Flagged changes in detail")));
  assert.equal((section.match(/<td><b>cl7<\/b>/g) || []).length, 1);
  assert.equal((section.match(/whether it matters depends on the gene/g) || []).length, 1);
  assert.equal((section.match(/<li>/g) || []).length, 4, "two flags for each of the two clones");
});

test("chromatograms are drawn for the clones that matter; detail: 'all' draws every one", () => {
  const results = ranked([named(clone(hom()), "x_Cl_1_A"), named(clone(hom(NONSENSE)), "x_Cl_2_A")]);
  const focus = (buildQcReportHtml({ workflow: "snp", results }).match(/<svg/g) || []).length;
  const everything = (buildQcReportHtml({ workflow: "snp", results, detail: "all" }).match(/<svg/g) || []).length;
  assert.ok(focus < everything, `${focus} < ${everything}`);
});

test("every action has a label and a sentence saying what to do", () => {
  for (const a of Object.values(ACTION)) { assert.ok(a.label.length > 3); assert.ok(a.how.length > 20); }
  assert.equal(nextAction("snp", { ok: false, error: "x" }).key, "fix");
});

test("long genotype sentences are shortened in the table and the rest are left as they are", () => {
  assert.equal(briefGenotype("Mixed or unclear: more than two alleles, or no clear major allele"), "Mixed or unclear (more than two alleles)");
  assert.equal(briefGenotype("Homozygous wild type (no edit detected)"), "Wild type, no edit");
  assert.equal(briefGenotype("Homozygous for +1 bp indel"), "Homozygous for +1 bp indel");
});
