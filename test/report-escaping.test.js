import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesign } from "../src/engine/design/designEngine.js";
import { buildReportHtml } from "../src/engine/design/reportHtml.js";
import { buildRowMeta, buildHistoricalContext, buildReviewItems } from "../src/engine/design/reportInputs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, "fixtures", f), "utf8");
const APOE = read("apoe-r154s.gb"), DIPK2A = read("dipk2a-region.gb");
const TAG_PAYLOAD = "<img src=x onerror=alert(1)>";
const ATTR_PAYLOAD = "\" autofocus onfocus=alert(2) x=\"";
const CASES = [["ko", DIPK2A, "", "", 400, "DIPK2A"], ["pm", APOE, "R154S", "", "", "APOE"], ["ct", APOE, "", "FLAG", 400, "APOE"], ["nt", APOE, "", "FLAG", 400, "APOE"], ["it", APOE, "R154", "SPOT", "", "APOE"]];

// every free-text field a user can type, plus the gene name carried in the uploaded GenBank record
function hostile(payload) {
  return { gene: "G" + payload, cellLine: "L" + payload, editSummary: "E" + payload, label: "T" + payload, mutation: "", fileName: "f" + payload + ".gb", irisId: "I" + payload, clientName: "C" + payload, notes: "N" + payload, comment: "M" + payload };
}

for (const [type, gb, mutation, tag, arm, gene] of CASES) {
  for (const [name, payload] of [["tag injection", TAG_PAYLOAD], ["attribute injection", ATTR_PAYLOAD]]) {
    test(`${type}: ${name} in report metadata, file name and GenBank gene name is escaped`, () => {
      const hostileGb = gb.replaceAll(`/gene="${gene}"`, `/gene="${gene}${payload.replaceAll('"', "'")}"`);
      const res = runDesign(type, hostileGb, mutation, tag, arm, { deliveryMethod: "rnp" });
      assert.ok(!res.err, res.err);
      const row = { ...hostile(payload), projectType: type, referenceSource: "genbank", deliveryMethod: "rnp", mutation };
      const meta = buildRowMeta(row, res);
      const html = buildReportHtml(meta, res, row.fileName, buildHistoricalContext(meta, res, type), buildReviewItems(meta, res, row.fileName), null);
      assert.ok(html.length > 5000);
      assert.equal(html.includes("<img src=x onerror"), false, "raw <img> from the payload");
      assert.equal(html.includes("autofocus onfocus=alert(2)\" x=\""), false, "payload closes an attribute and adds another");
      assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") || html.includes("&quot; autofocus onfocus=alert(2)"), "the text itself is still shown, as text");
    });
  }
}

test("ordinary reports are unchanged by escaping: no ampersand, angle bracket or quote of the design itself is double-escaped", () => {
  const res = runDesign("ko", DIPK2A, "", "", 400, { expectedGene: "DIPK2A", deliveryMethod: "rnp" });
  const meta = buildRowMeta({ gene: "DIPK2A", cellLine: "BIHi005-A", notes: "Notes & remarks < 5 mM", projectType: "ko", deliveryMethod: "rnp" }, res);
  const html = buildReportHtml(meta, res, "DIPK2A.gb", null, [], null);
  assert.ok(html.includes("Notes &amp; remarks &lt; 5 mM"));
  assert.equal(html.includes("&amp;amp;"), false); assert.equal(html.includes("&amp;lt;"), false);
  assert.ok(html.includes("BIHi005-A") && html.includes("<h1>Design: DIPK2A knockout</h1>"));
});
