import test from "node:test";
import { validateDesignSpec, reverseSpec } from "../src/engine/qc/designSpec.js";
import assert from "node:assert/strict";
import { runDesign, runDesignFromTranscriptModel, parseGB, selectKoGuidePair, summarizeProcurementReadiness, scoreResidualActivity } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel, findKoDesignTargetFromModel } from "../src/engine/design/transcriptModel.js";
import { findConfiguredModelGuides } from "../src/engine/design/enzymeModelGuides.js";
import { selectConfiguredEditGuides } from "../src/engine/design/enzymeWorkflow.js";
import { buildReportHtml, buildPmStrandModels, getBrunelloReferenceGuideSet } from "../src/engine/design/reportHtml.js";
import { buildDesignSchemeSvg } from "../src/engine/design/designScheme.js";
import { buildQcDesignSpec } from "../src/engine/design/qcExport.js";
import { buildBatchOrderRows } from "../src/engine/design/orderRows.js";
import { getReleaseVerdict } from "../src/engine/design/releaseVerdict.js";
import { designGenomicSnp, buildGenomicSnpReport } from "../src/engine/design/genomicSnp.js";

let seed = 19;
function random(n) { return Array.from({ length: n }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return "ACGT"[(seed >>> 16) % 4]; }).join(""); }
const site = "TTTAACGTCAGTCAGTACGATCGATCA", site2 = "TTTAACGTCAGTCAGTACGATCGATCC";
const flank = random(1200), intron = random(400), right = random(1200);
const first = "ATG" + site + site2 + "GCTAACATC".repeat(12), second = "GCTAACATC".repeat(18) + site + "TAA";
const seq = flank + first + intron + second + right;
const segments = [[1200, 1200 + first.length], [1600 + first.length, 1600 + first.length + second.length]];
const cdsLocation = `join(${segments.map(([a, b]) => `${a + 1}..${b}`).join(",")})`;
const gb = `LOCUS       TEST ${seq.length} bp DNA\nFEATURES             Location/Qualifiers
     gene            ${segments[0][0] + 1}..${segments[1][1]}
                     /gene="TEST"
     CDS             ${cdsLocation}
                     /gene="TEST"
                     /codon_start=1
${segments.map(([a, b], index) => `     exon            ${a + 1}..${b}\n                     /number="${index + 1}"`).join("\n")}
ORIGIN
        1 ${seq.toLowerCase()}
//\n`;
const model = normalizeGenBankToTranscriptModel(parseGB(gb));

test("native nearest-window policy keeps the closest lead and adds a distinct point-mutation partner", () => {
  const candidates = [
    { id: "near", sp: "ACGT".repeat(5), str: "+", cut: 100, d: 1 },
    { id: "too-close", sp: "ACGT".repeat(5), str: "-", cut: 102, d: 3 },
    { id: "partner", sp: "AGCT".repeat(5), str: "-", cut: 118, d: 19 },
    { id: "far-perfect", sp: "CAGT".repeat(5), str: "+", cut: 125, d: 26 },
  ];
  const selected = selectConfiguredEditGuides(candidates, guide => guide.id === "far-perfect" ? 0 : 2);
  assert.equal(selected.window, 10);
  assert.deepEqual(selected.guides.map(guide => guide.id), ["near", "partner"]);
  assert.equal(selected.partnerFallback.partnerCutDistance, 19);
});

for (const enzyme of ["mad7", "ascas12a", "lbcas12a"]) {
  test(`${enzyme}: knockout uses exactly the shared Cas9 pair/exon policy and screening primers`, () => {
    const result = runDesign("ko", gb, "", "", "", { enzyme, deliveryMethod: "rnp" });
    assert.ok(!result.err, result.err);
    const target = findKoDesignTargetFromModel(model, null, selectKoGuidePair,
      (reference, rc, anchor, range) => findConfiguredModelGuides(reference, anchor, range, { enzyme }));
    assert.equal(result.gs.length, 2);
    assert.deepEqual(result.gs.map(guide => guide.cut), target.pair.guides.map(guide => guide.cut));
    assert.ok(result.deletionOutcome.deletionSize > 0 && result.deletionOutcome.deletionSize <= 140);
    assert.ok(Array.isArray(result.deletionOutcome.cutBoundaryRange));
    assert.equal(result.ps.length, 2);
    assert.ok(result.primerCandidates.length);
    const html = buildReportHtml({ projectType: "ko", gene: "TEST" }, result, "TEST.gb", null, []);
    assert.match(html, /Knockout Design/);
    assert.ok(html.includes(result.gs[0].sp) && html.includes(result.gs[1].sp));
    assert.equal(getBrunelloReferenceGuideSet(result, { guides: [{ sp: "CAS9" }] }), null);
    assert.ok(!buildQcDesignSpec(result).err);
  });
  for (const type of ["pm", "it", "nt", "ct"]) {
    test(`${enzyme}/${type}: canonical report, donor, primer, ordering and QC contracts are complete`, () => {
      const mutation = type === "pm" ? "S10A" : type === "it" ? "S10" : "";
      const tag = type === "it" ? "SPOT" : type === "nt" ? "N:EGFP-Linker" : "SD40-2xHA";
      const result = runDesignFromTranscriptModel(type, model, mutation, tag, "", { enzyme, deliveryMethod: "rnp", coDeliveryBlocking: false, autoTrimArms: false });
      assert.ok(!result.err, result.err);
      assert.ok(result.gs.length >= 1 && result.gs.length <= 2);
      assert.ok(result.gs.every(guide => Math.abs(guide.d) <= 30 && guide.sp.length === 23));
      assert.equal(result.ps.length, 2);
      assert.ok(result.primerCandidates.length);
      if (type === "pm") {
        assert.equal(result.gs.length, 2);
        assert.equal(result.os.length, 2);
        assert.ok(result.os.every(donor => donor.od.length === 127 && donor.proteinValidation.valid));
        assert.ok(Math.abs(result.gs[0].d) <= 10);
        assert.ok(result.gs.every(guide => scoreResidualActivity(model, guide, []) === null));
        assert.ok(buildPmStrandModels(result.os[0]).every(strand => !strand.note.includes("91 bp and 36 bp")));
      } else if (type === "it") {
        assert.equal(result.os.length, result.gs.length);
        assert.ok(result.insertValidation.framePreserved);
      } else {
        assert.ok(result.donor.length > 0);
        assert.ok(result.h5l && result.h3l && result.insertValidation.framePreserved);
        assert.equal(result.primerStrategy, "recommended-outside-homology-arms");
      }
      const html = buildReportHtml({ projectType: type, gene: "TEST" }, result, "TEST.gb", null, []);
      assert.ok(html.includes(result.enzyme.name));
      assert.match(html, /Recommended Primers/);
      assert.ok(buildDesignSchemeSvg(result).includes("<svg"));
      const rows = buildBatchOrderRows([{ status: "success", slot: 1, row: { projectType: type }, result }]);
      assert.equal(rows.filter(row => row.itemType === "gRNA").length, result.gs.length);
      assert.ok(rows.some(row => row.itemType === "Donor"));
      assert.equal(rows.filter(row => row.itemType === "Primer").length, 2);
      assert.ok(rows.every(row => row.enzyme === enzyme && row.reviewNotes.includes(result.enzyme.version)));
      const qc = buildQcDesignSpec(result);
      assert.deepEqual(validateDesignSpec(qc).errors, []);
      assert.deepEqual(validateDesignSpec(reverseSpec(qc)).errors, []);
      assert.ok(!qc.err, qc.err);
      assert.ok(qc.guides.every(guide => guide.pam.length === 4 && guide.cuts && guide.enzyme === enzyme));
      assert.ok(qc.guides.every(guide => qc.reference.sequence.slice(guide.protospacerStart, guide.protospacerEnd).length === 23));
      assert.notEqual(getReleaseVerdict(result).status, "ready");
      assert.ok(!summarizeProcurementReadiness(result).warnings.some(warning => warning.includes("requires an explicit 20 nt")));
    });
  }
}

test("one knockout cut or an unmapped custom guide cannot masquerade as a pair", () => {
  assert.equal(selectKoGuidePair([{ cut: 10, str: "+", gc: 50 }, { cut: 10, str: "-", gc: 50 }]), null);
  const result = runDesign("ko", gb, "", "", "", { enzyme: "mad7", customGuides: ["A".repeat(23), "C".repeat(23)] });
  assert.match(result.err, /does not map/);
});

test("genomic SNP mode uses the same paired design and nucleotide checks with a 5-prime PAM", () => {
  const dna = random(1800);
  const record = `LOCUS       LOCUS ${dna.length} bp DNA\nFEATURES             Location/Qualifiers\nORIGIN\n1 ${dna.toLowerCase()}\n//\n`;
  const result = designGenomicSnp(record, { gene: "Locus", enzyme: "mad7", assembly: "test", chromosome: "1", referenceStart: 1000,
    position: 1600, ref: dna[600], alt: dna[600] === "A" ? "G" : "A", forwardConfirmed: true,
    blockingPolicy: "independent", deliveryMethod: "rnp" });
  assert.ok(!result.err, result.err);
  assert.equal(result.enzyme.id, "mad7");
  assert.ok(result.candidates.length);
  assert.ok(result.candidates.every(candidate => candidate.sp.length === 23 && candidate.nucleotideValidation.valid && candidate.protection.cfd === null));
  assert.ok(result.primers.length);
  assert.ok(buildGenomicSnpReport(result).includes("Mad7"));
  assert.ok(result.blocking.feasible, result.blocking.reason);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.blocking.cfdAfter.every(value => value === null));
});
