// Clone review: the alleles of the clones, as the SpliceAI and AlphaGenome requests carry them, and the results that come back. Simulated QC results on the bundled APOE reference; nothing is predicted here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runDesign } from "../src/engine/design/designEngine.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";
import {
  buildCloneSpliceRequest, buildCloneAlphaGenomeRequest, cloneAlleleCandidates, cloneReviewContext, collectReviewAlleles, reviewableClones,
  summariseCloneSplice, summariseCloneAlphaGenome, validateCloneSpliceResult, validateCloneAlphaGenomeReport,
  CLONE_SPLICE_RESULT_SCHEMA, CLONE_ALPHAGENOME_REPORT_SCHEMA, SPLICE_CHECK_THRESHOLDS,
} from "../src/services/cloneReview.js";

const raw = readFileSync(new URL("../public/references/apoe-ensg00000130203.gb", import.meta.url), "utf8");
const designResult = runDesign("pm", raw, "R176C", "", "", { enzyme: "spcas9" });
assert.ok(!designResult.err, designResult.err);
const project = { gene: "APOE", mutation: "R176C", genbankRaw: raw, options: { enzyme: "spcas9" }, designResult };
const spec = buildQcDesignSpec(designResult);
const genome = designResult.gb.genomicSequence.toUpperCase();
const offset = spec.reference.offset;
const donor = spec.donors[0];
const carried = (spec.markers || []).filter((m) => m.pos >= donor.refStart && m.pos < donor.refEnd && (!donor.carriesMarkers || donor.carriesMarkers.includes(m.pos)));
const window = spec.reference.sequence;
const edit = (m) => ({ start: m.pos, end: m.pos + 1, ref: m.ref, inserted: m.alt, role: m.role === "intended" ? "intended" : "blocking" });
const baseOf = (i) => window[i];
const other = (b) => ({ A: "C", C: "A", G: "T", T: "G" }[b]);

const intendedAllele = { label: "Intended edit (ssODN1)", kind: "edit", size: 0, fraction: 1, edits: carried.map(edit) };
const unplannedAt = 40;                                  // a base in the window the design does not change
const unplanned = { position: unplannedAt, relative: -5, ref: baseOf(unplannedAt), alt: other(baseOf(unplannedAt)), fraction: 0.9, confirmed: true, severity: "block" };
const deletionAt = donor.refStart + 5;
const deletion = { label: "Donor edit with -4 at gRNA1", kind: "edit_indel", size: -4, fraction: 0.5, edits: [{ start: deletionAt, end: deletionAt + 4, ref: window.slice(deletionAt, deletionAt + 4), inserted: "", role: "indel" }] };
const base = { ok: true, kind: "trace-pair", sampleType: "clone", workflow: "snp" };
const results = [
  { ...base, name: "c1", decision: { decision: "accept" }, alleles: [intendedAllele], unwanted: { changes: [], flags: [], worst: null } },
  { ...base, name: "c2", decision: { decision: "accept" }, alleles: [intendedAllele], unwanted: { changes: [], flags: [], worst: null } },
  { ...base, name: "c3", decision: { decision: "hold" }, alleles: [intendedAllele], unwanted: { changes: [unplanned], flags: [], worst: "review" } },
  { ...base, name: "c4", decision: { decision: "hold" }, alleles: [{ ...intendedAllele, fraction: 0.5 }, deletion], unwanted: { changes: [], flags: [], worst: null } },
  { ...base, name: "c5", decision: { decision: "reject" }, alleles: [intendedAllele], unwanted: { changes: [unplanned], flags: [], worst: "block" } },
  { ...base, name: "c6", decision: { decision: "reject" }, alleles: [], unwanted: { changes: [], flags: [], worst: null } },
  { ...base, name: "pool", sampleType: "pool", decision: { decision: "accept" }, alleles: [intendedAllele], unwanted: { changes: [], flags: [] } },
  { ok: false, name: "bad", error: "x" },
];

test("which clones are reviewed: reads with an allele to predict; a rejected clone only when its flag explains why", () => {
  assert.deepEqual(reviewableClones(results).map((r) => r.name), ["c1", "c2", "c3", "c4", "c5"]);
  assert.deepEqual(reviewableClones(results, { includeRejected: true }).map((r) => r.name), ["c1", "c2", "c3", "c4", "c5"]);
  const rejectedClean = { ...results[0], name: "x", decision: { decision: "reject" } };
  assert.ok(!reviewableClones([rejectedClean]).length);
});

test("an unplanned base is placed on the allele that carries the intended edit and the assumption is stated", () => {
  const withBase = cloneAlleleCandidates(results[2]);
  assert.equal(withBase.length, 1);
  assert.equal(withBase[0].edits.length, carried.length + 1);
  assert.ok(withBase[0].edits.some((e) => e.role === "unplanned" && e.start === unplannedAt));
  assert.match(withBase[0].assumption, /heterozygous/);
  const mixed = cloneAlleleCandidates(results[3]);
  assert.equal(mixed.length, 2);
  assert.deepEqual(mixed.map((a) => a.edits.some((e) => e.role === "indel")), [false, true]);
  assert.equal(cloneAlleleCandidates({ alleles: [], unwanted: { changes: [unplanned] } })[0].kind, "unplanned");
});

test("alleles are de-duplicated over clones, sit on the uploaded reference and are matched to the intended allele", async () => {
  const context = await cloneReviewContext(project);
  assert.equal(context.offset, offset);
  const { alleles } = collectReviewAlleles(context, results);
  const intended = alleles.find((a) => !a.unwanted && a.edits.every((e) => e.role !== "indel"));
  assert.deepEqual(intended.clones.map((c) => c.name).sort(), ["c1", "c2", "c4"], "one allele, three clones");
  const unwantedAllele = alleles.find((a) => a.edits.some((e) => e.role === "unplanned"));
  assert.deepEqual(unwantedAllele.clones.map((c) => c.name).sort(), ["c3", "c5"]);
  for (const a of alleles) for (const e of a.edits) assert.equal(genome.slice(e.start, e.end), e.ref, `${a.id} edit on the reference`);
  assert.deepEqual(intended.edits.map((e) => e.start), carried.map((m) => m.pos + offset));
  assert.equal(intended.intendedId, "D1");
  assert.ok(alleles[0].unwanted, "alleles with unwanted edits come first");
});

test("a mismatch with the reference is reported, never silently predicted", async () => {
  const context = await cloneReviewContext(project);
  const broken = [{ ...results[0], alleles: [{ ...intendedAllele, edits: intendedAllele.edits.map((e, i) => (i ? e : { ...e, ref: other(e.ref) })) }] }];
  assert.throws(() => collectReviewAlleles(context, broken), /does not match the reference/);
  await assert.rejects(cloneReviewContext({ gene: "APOE" }), /Open the design/);
});

test("SpliceAI request: reference-record coordinates, identity of the record, thresholds, intended alleles", async () => {
  const request = await buildCloneSpliceRequest(project, results);
  assert.equal(request.schema, "assured-clone-splice-request/1");
  assert.equal(request.reference.length, genome.length);
  assert.match(request.reference.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(request.thresholds, { pass: SPLICE_CHECK_THRESHOLDS.pass, review: SPLICE_CHECK_THRESHOLDS.review });
  assert.equal(request.intended.length, 1);
  assert.deepEqual(request.intended[0].edits.map((e) => e.start), carried.map((m) => m.pos + offset));
  assert.ok(request.alleles.some((a) => a.edits.some((e) => e.role === "unplanned")));
  assert.ok(request.alleles.some((a) => a.edits.some((e) => e.role === "indel" && e.inserted === "")));
  assert.match(request.requestId, /^[a-f0-9]{64}$/);
  const again = await buildCloneSpliceRequest(project, results);
  assert.equal(again.requestId, request.requestId, "same clones, same request");
  const changed = await buildCloneSpliceRequest(project, results.filter((r) => r.name !== "c3"));
  assert.notEqual(changed.requestId, request.requestId);
});

test("AlphaGenome request: edits on the GRCh38 chromosome, one cell context, a window that holds every edit", async () => {
  const settings = { ontologyTerm: "EFO:0009747" };
  const request = await buildCloneAlphaGenomeRequest(project, results, settings);
  assert.equal(request.schema, "assured-alphagenome-clone-request/1");
  assert.equal(request.chromosome, "chr19");
  const start = request.reference.start;
  for (const a of request.alleles) for (const e of a.edits) assert.equal(request.reference.sequence.slice(e.start - start + 1, e.end - start + 1), e.ref, "edits are absolute 0-based; the reference starts at a 1-based position");
  assert.deepEqual(request.requestedOutputs, ["RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE"]);
  await assert.rejects(buildCloneAlphaGenomeRequest(project, results, { ontologyTerm: "nonsense" }), /cell context/);
  await assert.rejects(buildCloneAlphaGenomeRequest({ ...project, genbankRaw: "" }, results, settings), /mapped/);
  await assert.rejects(buildCloneAlphaGenomeRequest(project, results, { ...settings, sequenceLength: 1000 }), /context length/);
});

test("a SpliceAI result is accepted only for its own request, and scores become verdicts at the design thresholds", async () => {
  const request = await buildCloneSpliceRequest(project, results);
  const rows = {};
  request.alleles.forEach((a, i) => { rows[a.id] = { editEffectMax: 0.01, unwantedEffectMax: a.unwanted ? [0.03, 0.12, 0.4][i % 3] : null, unwantedOnlyMax: null }; });
  const result = { schema: CLONE_SPLICE_RESULT_SCHEMA, tool: "SpliceAI", version: "1.3.1", requestId: request.requestId, summary: { alleles: rows } };
  const summary = summariseCloneSplice(request, result);
  for (const a of request.alleles) {
    const effect = a.unwanted ? rows[a.id].unwantedEffectMax : 0.01;
    assert.equal(summary.alleles[a.id].verdict, effect <= 0.05 ? "pass" : effect <= 0.2 ? "review" : "fail", a.id);
    assert.equal(summary.alleles[a.id].basis.includes("unwanted"), Boolean(a.unwanted));
  }
  const withBase = request.alleles.find((a) => a.clones.some((c) => c.name === "c3"));
  assert.equal(summary.clones.c3.allele, withBase.id);
  assert.throws(() => validateCloneSpliceResult({ ...result, requestId: "0".repeat(64) }, request), /different set of clones/);
  assert.throws(() => validateCloneSpliceResult({ ...result, schema: "x" }, request), /not a clone splice result/);
  assert.throws(() => validateCloneSpliceResult({ ...result, version: "" }, request), /provenance/);
  const missing = structuredClone(result); delete missing.summary.alleles[request.alleles[0].id];
  assert.throws(() => validateCloneSpliceResult(missing, request), /every allele/);
  const nan = structuredClone(result); nan.summary.alleles[request.alleles[0].id].editEffectMax = null;
  assert.throws(() => validateCloneSpliceResult(nan, request), /not numbers/);
});

test("an AlphaGenome report is accepted only for its own request; clones are ranked by the change against the intended allele", async () => {
  const request = await buildCloneAlphaGenomeRequest(project, results, { ontologyTerm: "EFO:0009747" });
  const report = {
    schema: CLONE_ALPHAGENOME_REPORT_SCHEMA, status: "complete", evidenceType: "model-prediction", requestId: request.requestId, modelVersion: "ALL_FOLDS", sdkVersion: "0.10.0", ontologyTerms: request.ontologyTerms,
    alleles: request.alleles.map((a, i) => ({ id: a.id, comparisons: ["reference_to_allele", "intended_to_allele"].map((id) => ({ id, tracks: request.requestedOutputs.map((output) => ({ name: "t", output, meanDelta: 0, meanAbsDelta: 0.001 * (i + 1), maxAbsDelta: 0.01 * (i + 1) })) })) })),
  };
  const summary = summariseCloneAlphaGenome(request, report);
  const withPartner = request.alleles.find((a) => a.intendedId);
  assert.equal(summary.alleles[withPartner.id].comparison, "intended_to_allele");
  assert.ok(Object.keys(summary.clones).includes("c3"));
  assert.throws(() => validateCloneAlphaGenomeReport({ ...report, requestId: "0".repeat(64) }, request), /different set of clones/);
  assert.throws(() => validateCloneAlphaGenomeReport({ ...report, status: "failed" }, request), /incomplete/);
  assert.throws(() => validateCloneAlphaGenomeReport({ ...report, alleles: report.alleles.slice(1) }, request), /no comparison/);
});

test("the larger edit of a knock-in allele is the intended edit, that of an indel allele is not; an unknown role is an unplanned base", () => {
  const tag = { label: "Intended edit (tag)", kind: "edit", size: 0, fraction: 1, edits: [{ start: 100, end: 100, ref: "", inserted: "ACGTACGTACGT", role: "intended" }] };
  const [a] = cloneAlleleCandidates({ alleles: [tag], unwanted: { changes: [] } });
  assert.equal(a.unwanted, false, "a designed insertion is not an unwanted change");
  const odd = cloneAlleleCandidates({ alleles: [{ label: "x", kind: "edit", fraction: 1, edits: [{ start: 5, end: 6, ref: "A", inserted: "C", role: "other" }] }], unwanted: { changes: [] } })[0];
  assert.equal(odd.edits[0].role, "unplanned");
  assert.equal(odd.unwanted, true);
});


test("original experimental QC spec uses an exact unique reference core, never regenerated donors", async () => {
  const reference = genome.slice(100, 400);
  const imported = { schema: "assured-qc-design/1", design: { gene: "APOE", editKind: "snp" }, reference: { sequence: reference, offset: 0 }, guides: [], donors: [], markers: [] };
  const context = await cloneReviewContext({ qcDesignSpec: imported, cloneReviewReferenceRaw: raw });
  assert.equal(context.offset, 100);
  const noisy = structuredClone(imported);
  noisy.reference.sequence = other(reference[0]) + reference.slice(1, -1) + other(reference.at(-1));
  const trimmed = await cloneReviewContext({ qcDesignSpec: noisy, cloneReviewReferenceRaw: raw });
  assert.equal(trimmed.offset, 100);
  assert.deepEqual(trimmed.verifiedCore, [30, 270]);
  noisy.reference.sequence = noisy.reference.sequence.slice(0, 100) + other(reference[100]) + noisy.reference.sequence.slice(101);
  await assert.rejects(cloneReviewContext({ qcDesignSpec: noisy, cloneReviewReferenceRaw: raw }), /no unique exact match/);
});
