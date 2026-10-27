import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildAlphaGenomeRequest, compareDonorBlockerLayouts, listDonorAlleleVariants, reviewRequestId, summarizeBlockerSafety, validateAlphaGenomeReport } from "../src/services/alphaGenomeReview.js";
import { appendAlphaGenomeReview, generateReportHtml } from "../src/services/designExport.js";
import { buildTakeHome } from "../src/services/takeHome.js";
import { runDesign } from "../src/engine/design/designEngine.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";
import { updateProject, createProject } from "../src/services/projectState.js";

function project() {
  const sequence = "A".repeat(250);
  const donor = sequence.slice(60, 187).split("");
  donor[40] = "T"; donor[50] = "C";
  const alternate = [...donor]; alternate[50] = "G";
  return { gene: "TEST", designResult: {
    type: "pm", gene: "TEST", gp: 100, gb: { genomicSequence: sequence },
    gs: [{ sp: "A".repeat(20), str: "+", cut: 90 }], ps: [],
    os: [donor, alternate].map((bases, i) => ({ n: `donor${i}`, donorStart: 60, donorEnd: 187, genomicDonor: bases.join(""), desiredDiffIndexes: [40] })),
  } };
}
const mapping = { assembly: "GRCh38", chromosome: "17", referenceStart: 100000, orientation: 1, ontologyTerm: "CL:0000000", mappingConfirmed: true };

test("donor request includes only the selected donor edits, with an offline Python-verifiable digest", async () => {
  const request = await buildAlphaGenomeRequest(project(), mapping);
  assert.deepEqual(request.variants, [
    { position: 100100, ref: "A", alt: "T", role: "intended" },
    { position: 100110, ref: "A", alt: "C", role: "blocking" },
  ]);
  const alternate = await buildAlphaGenomeRequest(project(), { ...mapping, donorIndex: 1 });
  assert.equal(alternate.variants[1].alt, "G");
  assert.notEqual(request.requestId, alternate.requestId);
  const directory = mkdtempSync(join(tmpdir(), "assured-alpha-"));
  try {
    const input = join(directory, "request.json");
    writeFileSync(input, JSON.stringify(request));
    const run = spawnSync("python3", ["tools/alphagenome/review.py", input, "--validate-only"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).predictionPerformed, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("reverse-strand donor maps positions and complements alleles to chromosome plus", async () => {
  const request = await buildAlphaGenomeRequest(project(), { ...mapping, orientation: -1 });
  assert.equal(request.reference.sequence, "T".repeat(250));
  assert.deepEqual(request.variants, [
    { position: 100139, ref: "T", alt: "G", role: "blocking" },
    { position: 100149, ref: "T", alt: "A", role: "intended" },
  ]);
});

test("review requires explicit mapping and rejects annotation conflicts, missing intended edit and unsupported designs", async () => {
  await assert.rejects(buildAlphaGenomeRequest(project(), { ...mapping, mappingConfirmed: false }), /Confirm/);
  await assert.rejects(buildAlphaGenomeRequest(project(), { ...mapping, assembly: "GRCh37" }), /GRCh38/);
  await assert.rejects(buildAlphaGenomeRequest(project(), { ...mapping, ontologyTerm: "liver" }), /ontology/);
  const conflict = { ...project(), genbankRaw: "Location: chromosome:GRCh38:17:200000:200249:1" };
  await assert.rejects(buildAlphaGenomeRequest(conflict, mapping), /conflicts/);
  const noIntended = project(); noIntended.designResult.os.forEach(d => { d.desiredDiffIndexes = []; }); noIntended.designResult.gp = null;
  await assert.rejects(buildAlphaGenomeRequest(noIntended, mapping), /No validated intended/);
  const ko = project(); ko.designResult.type = "ko";
  await assert.rejects(buildAlphaGenomeRequest(ko, mapping), /substitution designs only/);
});

test("AlphaGenome request works on a real TP53 point-mutation design", async () => {
  const raw = readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
  const result = runDesign("pm", raw, "R175H", "", "", { enzyme: "spcas9", expectedGene: "TP53" });
  assert.ok(!result.err, result.err);
  const spec = buildQcDesignSpec(result);
  const intended = spec.markers.filter(m => m.role === "intended");
  assert.deepEqual(intended.map(m => m.pos + spec.reference.offset), result.ch.map(c => c.p));
  // Artificial chromosome start is used only to check extraction and digest;
  // a live run must validate the actual mapping against GRCh38 first.
  const request = await buildAlphaGenomeRequest({ gene: "TP53", designResult: result }, mapping);
  assert.ok(request.variants.some(v => v.role === "intended"));
  assert.ok(request.variants.length >= 1);
});

test("report import rejects stale donor/tissue requests, incomplete runs and invalid metrics", async () => {
  const request = await buildAlphaGenomeRequest(project(), mapping);
  const report = {
    schema: "assured-alphagenome-review/1", status: "complete", evidenceType: "model-prediction",
    requestId: request.requestId, modelVersion: "ALL_FOLDS", sdkVersion: "0.10.0",
    comparisons: ["reference_to_intended", "reference_to_full_donor", "intended_to_full_donor"].map(id => ({ id, tracks: request.requestedOutputs.map(output => ({ name: "test", output, meanDelta: 0, meanAbsDelta: 0, maxAbsDelta: 0 })) })),
  };
  assert.equal(validateAlphaGenomeReport(report, request), report);
  const changed = await buildAlphaGenomeRequest(project(), { ...mapping, ontologyTerm: "CL:0000001" });
  assert.throws(() => validateAlphaGenomeReport(report, changed), /does not match/);
  assert.throws(() => validateAlphaGenomeReport({ ...report, status: "failed" }, request));
  const partial = structuredClone(report); partial.comparisons[0].tracks.pop();
  assert.throws(() => validateAlphaGenomeReport(partial, request), /missing requested/);
  const malformed = structuredClone(report); malformed.comparisons[0].tracks[0].meanDelta = null;
  assert.throws(() => validateAlphaGenomeReport(malformed, request), /invalid track/);
  const payload = { ...request }; delete payload.requestId;
  assert.equal(await reviewRequestId(payload), request.requestId);
});

test("research tissue presets are exact PSC/derivative ontology IDs (not generic iPSC)", async () => {
  const { ALPHAGENOME_RESEARCH_TISSUES } = await import("../src/services/alphaGenomeReview.js");
  assert.ok(ALPHAGENOME_RESEARCH_TISSUES.length >= 5);
  const ids = ALPHAGENOME_RESEARCH_TISSUES.map((t) => t.id);
  assert.ok(ids.includes("EFO:0009747"), "WTC11");
  assert.ok(ids.includes("EFO:0003042"), "H1");
  assert.ok(ids.includes("EFO:0003045"), "H9");
  assert.ok(!ids.includes("EFO:0004905"), "generic iPSC has no tracks");
  assert.ok(!ids.includes("CL:0002322"), "generic ESC has no tracks");
  for (const tissue of ALPHAGENOME_RESEARCH_TISSUES) {
    assert.match(tissue.id, /^(?:UBERON|CL|EFO):\d+$/);
    assert.ok(tissue.label.includes(tissue.id));
    assert.equal(tissue.match, "exact");
  }
});

function fakeReport({
  intendedRna = 1, blockerRna = 0.2,
  intendedSites = 0.01, blockerSites = 0.002,
  intendedUsage = 0.01, blockerUsage = 0.002,
} = {}) {
  const track = (output, name, maxAbsDelta) => ({
    name, output, strand: "+", meanDelta: 0, meanAbsDelta: maxAbsDelta / 2, maxAbsDelta,
  });
  return {
    schema: "assured-alphagenome-review/1", status: "complete", evidenceType: "model-prediction",
    requestId: "x", modelVersion: "ALL_FOLDS", sdkVersion: "0.10.0", ontologyTerms: ["EFO:0009747"],
    comparisons: [
      {
        id: "reference_to_intended",
        tracks: [
          track("RNA_SEQ", "WTC11 polyA", intendedRna),
          track("SPLICE_SITES", "donor", intendedSites),
          track("SPLICE_SITE_USAGE", "usage_WTC11", intendedUsage),
        ],
      },
      {
        id: "reference_to_full_donor",
        tracks: [
          track("RNA_SEQ", "WTC11 polyA", intendedRna + blockerRna),
          track("SPLICE_SITES", "donor", intendedSites + blockerSites),
          track("SPLICE_SITE_USAGE", "usage_WTC11", intendedUsage + blockerUsage),
        ],
      },
      {
        id: "intended_to_full_donor",
        tracks: [
          track("RNA_SEQ", "WTC11 polyA", blockerRna),
          track("SPLICE_SITES", "donor", blockerSites),
          track("SPLICE_SITE_USAGE", "usage_WTC11", blockerUsage),
        ],
      },
    ],
  };
}

test("blocker-safety summary flags when silent blockers dominate intended-edit peaks", () => {
  const minor = summarizeBlockerSafety(fakeReport({ intendedRna: 2, blockerRna: 0.2 }));
  assert.equal(minor.verdict, "blockers_minor");
  assert.equal(minor.severity, "info");

  const notable = summarizeBlockerSafety(fakeReport({ intendedRna: 2, blockerRna: 1.2 }));
  assert.equal(notable.verdict, "blockers_notable");
  assert.equal(notable.severity, "warn");
  assert.match(notable.text, /notable share/i);

  const dominate = summarizeBlockerSafety(fakeReport({ intendedRna: 1.25, blockerRna: 2.5 }), {
    donor: "ssODN1", ontologyTerms: ["EFO:0009747"],
  });
  assert.equal(dominate.verdict, "blockers_dominate");
  assert.equal(dominate.severity, "warn");
  assert.match(dominate.text, /ssODN1/);
  assert.match(dominate.text, /EFO:0009747/);
  assert.match(dominate.nextStep, /alternate|leaner|blocker/i);

  // Equal tiny splice-usage bins must not alone force dominate (RNA ~71% → notable).
  const usageNoise = summarizeBlockerSafety(fakeReport({
    intendedRna: 1.75, blockerRna: 1.25,
    intendedSites: 0.015625, blockerSites: 0.00819,
    intendedUsage: 0.00390625, blockerUsage: 0.00390625,
  }));
  assert.equal(usageNoise.verdict, "blockers_notable", "RNA ~71% of intended → notable; usage floor ignored");
});

test("take-home watch line carries AlphaGenome blocker risk without changing procurement status", async () => {
  const design = {
    type: "pm", gene: "APOE", mutation: "R176C",
    gs: [{ n: "g1", sp: "ACGTACGTACGTACGTACGT", pm: "TGG", str: "+" }],
    dl: 127, amp: "WT ~480 bp",
    procurement: { status: "ready", blockers: [], warnings: [] },
  };
  const request = { donor: "ssODN1", ontologyTerms: ["EFO:0009747"], requestedOutputs: ["RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE"] };
  const without = buildTakeHome({ designResult: design });
  assert.equal(without.status.label, "Ready to order");
  assert.ok(!without.watch.some((w) => w.key === "alphagenome"));

  const withAlpha = buildTakeHome({
    designResult: design,
    alphaGenomeReview: { request, report: fakeReport({ intendedRna: 1, blockerRna: 2 }) },
  });
  assert.equal(withAlpha.status.label, "Ready to order", "AlphaGenome must not gate READY");
  const watch = withAlpha.watch.find((w) => w.key === "alphagenome");
  assert.ok(watch);
  assert.equal(watch.tone, "warn");
  assert.match(withAlpha.bottomLine, /Main risk:.*blocker/i);
  assert.ok(withAlpha.nextSteps[0].match(/blocker|donor|AlphaGenome/i));
});

test("step 1: GenBank annotations auto-detect GRCh38 mapping for AlphaGenome", async () => {
  const { detectGenomicMappingFromGenbank, normalizeHumanAssembly, alphaGenomeMapping } = await import("../src/services/alphaGenomeReview.js");
  assert.equal(normalizeHumanAssembly("hg38"), "GRCh38");
  assert.equal(normalizeHumanAssembly("GRCh38.p14"), "GRCh38");

  const canonical = detectGenomicMappingFromGenbank("COMMENT Location: chromosome:GRCh38:17:7661779:7687538:1");
  assert.deepEqual(
    { assembly: canonical.assembly, chromosome: canonical.chromosome, referenceStart: canonical.referenceStart, orientation: canonical.orientation },
    { assembly: "GRCh38", chromosome: "17", referenceStart: 7661779, orientation: 1 }
  );

  const apoe = readFileSync(new URL("../public/references/apoe-ensg00000130203.gb", import.meta.url), "utf8");
  const fromApoe = detectGenomicMappingFromGenbank(apoe);
  assert.equal(fromApoe.assembly, "GRCh38");
  assert.equal(fromApoe.chromosome, "19");
  assert.equal(fromApoe.referenceStart, 44905754);
  assert.equal(fromApoe.orientation, 1);
  assert.equal(fromApoe.source, "location-chr-range");

  const dipk = readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");
  const fromDipk = detectGenomicMappingFromGenbank(dipk);
  assert.equal(fromDipk.assembly, "GRCh38");
  assert.equal(fromDipk.chromosome, "3");
  assert.equal(fromDipk.referenceStart, 143971198);
  assert.equal(fromDipk.orientation, 1);
  assert.equal(fromDipk.source, "definition-nc-region");

  const tp53 = readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
  assert.equal(detectGenomicMappingFromGenbank(tp53), null, "RefSeqGene NG_ without genomic interval is not invented");

  assert.equal(alphaGenomeMapping({ genbankRaw: apoe }).grch38, true);
  assert.equal(alphaGenomeMapping({ genbankRaw: tp53 }), null);
});

test("step 2: imported AlphaGenome review folds into the design HTML report and clears on redesign", async () => {
  const request = await buildAlphaGenomeRequest(project(), mapping);
  const report = {
    schema: "assured-alphagenome-review/1", status: "complete", evidenceType: "model-prediction",
    requestId: request.requestId, modelVersion: "ALL_FOLDS", sdkVersion: "0.10.0",
    comparisons: ["reference_to_intended", "reference_to_full_donor", "intended_to_full_donor"].map(id => ({
      id,
      tracks: request.requestedOutputs.map(output => ({
        name: "test<script>", output, strand: "+", meanDelta: 0.1, meanAbsDelta: 0.2, maxAbsDelta: 0.3,
      })),
    })),
  };
  const review = { request, report, importedAt: "2026-10-27T09:00:00.000Z", options: { ...mapping, donorIndex: 0, sequenceLength: 16384 } };

  assert.equal(appendAlphaGenomeReview("<html><body>x</body></html>", null), "<html><body>x</body></html>");
  assert.equal(appendAlphaGenomeReview("<html><body>x</body></html>", { report }), "<html><body>x</body></html>");

  const folded = appendAlphaGenomeReview("<html><body>report</body></html>", review);
  assert.match(folded, /AlphaGenome research review \(not a release gate\)/);
  assert.match(folded, /Research only/);
  assert.match(folded, /test&lt;script&gt;/);
  assert.ok(!folded.includes("test<script>"));
  assert.match(folded, /Reference → intended edit/);
  assert.match(folded, /Intended edit → full donor allele/);

  const raw = readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
  const design = runDesign("pm", raw, "R175H", "", "", { enzyme: "spcas9", expectedGene: "TP53" });
  assert.ok(!design.err, design.err);
  const html = generateReportHtml({ gene: "TP53", editType: "pm", options: {}, alphaGenomeReview: review, genbankRaw: raw }, design);
  assert.match(html, /AlphaGenome research review \(not a release gate\)/);
  assert.match(html, new RegExp(String(request.requestId).slice(0, 12)));

  const base = { ...createProject(), gene: "TP53", editType: "pm", designResult: design, alphaGenomeReview: review };
  const cleared = updateProject(base, { mutation: "R248Q" });
  assert.equal(cleared.alphaGenomeReview, null);
  assert.equal(cleared.designResult, null);
});

test("step 3: donor A vs B compares blocker layouts that share the same intended edit", async () => {
  const raw = readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
  const design = runDesign("pm", raw, "R175H", "", "", { enzyme: "spcas9", expectedGene: "TP53" });
  assert.ok(!design.err, design.err);
  assert.ok((design.os || []).length >= 2, "fixture needs two matched donors");
  const projectWithDesign = { gene: "TP53", designResult: design, genbankRaw: raw };

  const a = listDonorAlleleVariants(projectWithDesign, { donorIndex: 0 });
  const b = listDonorAlleleVariants(projectWithDesign, { donorIndex: 1 });
  assert.ok(a.variants.some(v => v.role === "intended"));
  assert.ok(b.variants.some(v => v.role === "blocking"));

  const compared = compareDonorBlockerLayouts(projectWithDesign, { donorIndexA: 0, donorIndexB: 1 });
  assert.equal(compared.summary.intendedShared, 1);
  assert.ok(compared.summary.blockingOnlyA >= 1);
  assert.ok(compared.summary.blockingOnlyB >= 1);
  assert.ok(compared.rows.every(r => r.label));
  assert.equal(compared.mapped, false);

  const mapped = compareDonorBlockerLayouts(projectWithDesign, {
    donorIndexA: 0, donorIndexB: 1, referenceStart: 100000, orientation: 1,
  });
  assert.equal(mapped.mapped, true);
  assert.ok(mapped.sharedIntended[0].position > 100000);

  assert.throws(() => compareDonorBlockerLayouts(projectWithDesign, { donorIndexA: 0, donorIndexB: 0 }), /two different/);

  const requestA = await buildAlphaGenomeRequest(projectWithDesign, { ...mapping, donorIndex: 0 });
  const requestB = await buildAlphaGenomeRequest(projectWithDesign, { ...mapping, donorIndex: 1 });
  assert.notEqual(requestA.requestId, requestB.requestId);
  assert.deepEqual(
    requestA.variants.filter(v => v.role === "intended"),
    requestB.variants.filter(v => v.role === "intended"),
  );
});
