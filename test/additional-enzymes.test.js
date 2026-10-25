import test from "node:test";
import { validateDesignSpec } from "../src/engine/qc/designSpec.js";
import assert from "node:assert/strict";
import { runDesign, runDesignFromTranscriptModel, parseGB, selectKoGuidePair, summarizeProcurementReadiness, scoreResidualActivity, toAA } from "../src/engine/design/designEngine.js";
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
const site = "ACGTCAGTCAGTACGATCGATAAGAAT", site2 = "TTTAACGTCAGTCAGTACGATCGATCC";
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


for (const enzyme of ["spcas9ng", "sacas9", "spry"]) {
  for (const type of ["ko", "pm", "it", "nt", "ct"]) {
    test(enzyme + "/" + type + ": full workflow and QC handoff", () => {
      const aa = toAA(model.cdsSequence.slice(27, 30));
      const mutation = type === "pm" ? aa + "10" + (aa === "A" ? "G" : "A") : type === "it" ? aa + "10" : "";
      const result = runDesignFromTranscriptModel(type, model, mutation, type === "it" ? "SPOT" : type === "nt" ? "N:EGFP-Linker" : "SD40-2xHA", "", { enzyme, deliveryMethod: "rnp", coDeliveryBlocking: false, autoTrimArms: false });
      assert.ok(!result.err, result.err);
      assert.ok(result.gs.length > 0);
      const length = enzyme === "sacas9" ? 21 : 20;
      assert.ok(result.gs.every(g => g.sp.length === length && g.cuts.target === g.cuts.non_target));
      assert.ok(result.ps.length === 2);
      if (type === "ko") {
        assert.equal(result.gs.length, 2);
        assert.equal(result.deletionOutcome.staggeredEnds, false);
      }
      if (type === "pm") {
        assert.ok(result.os.length > 0);
        assert.ok(result.os.every(d => d.od.length === 127 && d.proteinValidation.valid));
      }
      const qc = buildQcDesignSpec(result);
      assert.ok(!qc.err, qc.err);
      assert.equal(qc.design.enzyme.id, enzyme);
      assert.ok(buildReportHtml({ projectType: type, gene: "TEST" }, result, "TEST.gb", null, []).includes(result.enzyme.name));
      assert.ok(buildBatchOrderRows([{ status: "success", slot: 1, row: { projectType: type }, result }]).some(row => row.itemType === "gRNA" && row.enzyme === enzyme));
      const checked = validateDesignSpec(qc); assert.ok(checked.ok, checked.errors.join("; "));
    });
  }
}

test("SpRY PAM-only mutations never count as re-cutting protection", async () => {
  const { findEnzymeGuides } = await import("../src/engine/design/enzymeGuides.js");
  const { assessEnzymeReCutting } = await import("../src/engine/design/enzymeDonors.js");
  const { getEnzyme } = await import("../src/engine/design/enzymeConfig.js");
  const spacer = "ACGTCAGTCAGTACGATCGA";
  const reference = "GAC".repeat(30) + spacer + "AGG" + "GAC".repeat(30);
  const guide = findEnzymeGuides(reference, { enzyme: "spry" }).find(g => g.start === 90 && g.strand === "+");
  const changedPam = [{ start: guide.pam_start, end: guide.pam_end, sequence: "CTT" }];
  const risk = assessEnzymeReCutting({ genomicSequence: reference }, guide, getEnzyme("spry"), changedPam);
  assert.equal(risk.state, "intact_target");
  assert.equal(risk.residual_activity, null);
});
