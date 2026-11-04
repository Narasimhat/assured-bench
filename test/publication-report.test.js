import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runDesign } from "../src/engine/design/designEngine.js";
import { generateReportHtml, buildSupplementaryFasta } from "../src/services/designExport.js";
import { parseDesignReport } from "../src/engine/qc/designReport.js";
const raw = readFileSync(new URL("./fixtures/apoe-r154s.gb", import.meta.url), "utf8");
for (const [type, mutation, tag] of [["ko", "", ""], ["pm", "R154S", ""], ["ct", "", "FLAG"], ["nt", "", "FLAG"], ["it", "R154", "SPOT"]]) {
  test(`scientific ${type} report retains guide and donor handoff, labels uncertainty and contains no collapsed content`, () => {
    const result = runDesign(type, raw, mutation, tag, 400, { enzyme: "spcas9", deliveryMethod: "rnp" });
    assert.equal(result.err, undefined);
    const project = { gene: "APOE", editType: type, mutation, tag, options: { enzyme: "spcas9" } };
    const html = generateReportHtml(project, result);
    assert.doesNotMatch(html, /<details|<script|\[cell line\]|\[add\]/);
    assert.match(html, /No experimental results are included/);
    assert.match(html, /Not recorded/);
    assert.match(html, /Population variants under the guide and primer targets were not assessed/);
    assert.match(html, /Figure 1\./);
    assert.match(html, /Figure 2\./);
    assert.match(html, /Table 1\./);
    assert.match(html, /Table 7\. Epistemic classification and human review gates\./);
    assert.match(html, /Verified in reference/);
    assert.match(html, /Unknown \/ unassessed/);
    assert.match(html, /Experimentally demonstrated: none \(pre-experimental\)/);
    assert.match(html, /id="references"/);
    const imported = parseDesignReport(html);
    assert.equal(imported.length, 1);
    assert.deepEqual(imported[0].guides.map(g => g.sequence), result.gs.map(g => g.sp));
    if (["pm", "it"].includes(type)) assert.ok(imported[0].donors.length > 0, "QC still finds donor sequences");
    const fasta = buildSupplementaryFasta(result);
    for (const g of result.gs) assert.ok(fasta.includes(g.sp));
    for (const p of result.ps) assert.ok(fasta.includes(p.s));
    assert.match(fasta, /supplementary_record_not_order_authorization/);
  });
}

test("scientific narrative and provenance escape untrusted text", () => {
  const result = runDesign("ko", raw, "", "", 400);
  const payload = '<img src=x onerror="alert(1)">';
  const html = generateReportHtml({ gene: "APOE", biomniReport: { evidence: [{ topic: payload, type: "missing", source: payload }] } }, { ...result, gene: payload, procurement: { status: "blocked", blockers: [payload] } });
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;img src=x/);
});

test("raw genomic substitution reports adapt candidates and preserve their blocked/review state", async () => {
  const { designGenomicSnp } = await import("../src/engine/design/genomicSnp.js");
  const raw = readFileSync(new URL("../public/references/apoe-ensg00000130203.gb", import.meta.url), "utf8");
  const result = designGenomicSnp(raw, { gene: "APOE", assembly: "GRCh38", chromosome: "19", referenceStart: 44905791, position: 44907290, ref: "T", alt: "C", forwardConfirmed: true, blockingPolicy: "pair", deliveryMethod: "rnp" });
  assert.equal(result.err, undefined);
  const html = generateReportHtml({ gene: "APOE" }, result);
  assert.match(html, /Computational design of a genomic substitution at APOE/);
  assert.doesNotMatch(html, /<details|\[cell line\]/);
  const parsed = parseDesignReport(html);
  assert.ok(parsed[0].guides.length > 0);
  const blocked = generateReportHtml({ gene: "APOE" }, { ...result, status: "BLOCKED", blockers: ["Specific genomic blocker"] });
  assert.match(blocked, /Design status: blocked/);
  assert.match(blocked, /Specific genomic blocker/);
});
