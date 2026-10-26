// Records the E-utilities responses of one variant screen as a test fixture (test/fixtures/dbsnp-*.json), so the screen can be replayed offline.
//   NODE_USE_ENV_PROXY=1 node scripts/record_dbsnp_fixture.mjs reference.gb out.json "SPACER1,SPACER2"
// esummary documents are reduced to the fields the screen reads (uid, snp_id, chrpos, snp_class, global_mafs and the NC_ entries of the HGVS docsum).
import fs from "node:fs";
import { runDesign } from "../src/engine/design/designEngine.js";
import { screenTargetVariants } from "../src/services/variantScreen.js";

const [gbFile, outFile, spacers] = process.argv.slice(2);
if (!gbFile || !outFile) { console.error("usage: record_dbsnp_fixture.mjs reference.gb out.json [SPACER1,SPACER2]"); process.exit(2); }
const genbankRaw = fs.readFileSync(gbFile, "utf8");
const design = runDesign("ko", genbankRaw, "", "", 400, { deliveryMethod: "rnp", ...(spacers ? { customGuides: spacers.split(",") } : {}) });
if (design.err) { console.error(design.err); process.exit(1); }
const responses = {};
const recording = async (url, options) => {
  const response = await fetch(url, options); const json = await response.clone().json();
  if (json?.result) for (const id of Object.keys(json.result)) { const d = json.result[id]; if (d && d.snp_id) json.result[id] = { uid: d.uid, snp_id: d.snp_id, chrpos: d.chrpos, snp_class: d.snp_class, global_mafs: d.global_mafs, docsum: `HGVS=${(String(d.docsum).match(/NC_\d+\.\d+:g\.[^,|]+/g) || []).join(",")}` }; }
  responses[url] = json; return { ok: response.ok, status: response.status, json: async () => json };
};
const result = await screenTargetVariants({ genbankRaw, designResult: design, fetchFn: recording, delayMs: 400 });
fs.writeFileSync(outFile, JSON.stringify({ recordedAt: new Date().toISOString(), source: "NCBI E-utilities db=snp", status: result.status, responses }));
console.log(result.status, "|", result.summary.slice(0, 300), "|", Object.keys(responses).length, "responses");
