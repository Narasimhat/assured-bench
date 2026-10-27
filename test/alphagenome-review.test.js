import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildAlphaGenomeRequest, reviewRequestId, validateAlphaGenomeReport } from "../src/services/alphaGenomeReview.js";
import { runDesign } from "../src/engine/design/designEngine.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";

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

test("research tissue presets are ontology IDs AlphaGenome can be asked for", async () => {
  const { ALPHAGENOME_RESEARCH_TISSUES } = await import("../src/services/alphaGenomeReview.js");
  assert.ok(ALPHAGENOME_RESEARCH_TISSUES.length >= 5);
  for (const tissue of ALPHAGENOME_RESEARCH_TISSUES) {
    assert.match(tissue.id, /^(?:UBERON|CL|EFO):\d+$/);
    assert.ok(tissue.label.includes(tissue.id));
  }
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
