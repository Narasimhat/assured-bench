import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withoutRunOverrides } from "../src/services/runOptions.js";
import { runBiomniCoScientist } from "../src/services/biomniAgent.js";
import { BRUNELLO_SUBSET } from "../src/services/data/brunelloSubset.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DIPK2A = fs.readFileSync(path.join(ROOT, "public", "references", "dipk2a-region.gb"), "utf8");
// two spacers of the APOE reference, left in a project's options by an earlier APOE design
const APOE_CUSTOM = ["AACTGGCACTGGGTCGCTTT", BRUNELLO_SUBSET.APOE.guides[0].spacer];

test("withoutRunOverrides drops the pasted guides and keeps every other setting; it does not mutate its input", () => {
  const saved = { enzyme: "spcas9", deliveryMethod: "rnp", customGuides: APOE_CUSTOM, maxBlockingChanges: 3 };
  assert.deepEqual(withoutRunOverrides(saved), { enzyme: "spcas9", deliveryMethod: "rnp", maxBlockingChanges: 3 });
  assert.deepEqual(saved.customGuides, APOE_CUSTOM);
  assert.deepEqual(withoutRunOverrides(undefined), {}); assert.deepEqual(withoutRunOverrides(null), {});
});

test("a project that still carries another gene's custom guides designs a new gene normally (it failed with 'Custom gRNA ... could not be mapped')", async () => {
  const project = { id: "p", gene: "DIPK2A", genbankRaw: DIPK2A, options: { enzyme: "spcas9", deliveryMethod: "rnp", customGuides: APOE_CUSTOM } };
  const res = await runBiomniCoScientist("Design a biallelic knockout for DIPK2A and rank exon guides with Lindel", project, { fetchFn: async () => ({ ok: false, status: 404 }) });
  const design = res.steps.find((s) => s.tool === "design_crispr_edit");
  assert.equal(design.output.ok, true, design.output.error);
  assert.equal(res.designResult.gs.length, 2);
  assert.ok(!res.designResult.gs.some((g) => APOE_CUSTOM.includes(g.sp)), "the stale APOE guides were not used");
  assert.deepEqual(project.options.customGuides, APOE_CUSTOM, "the caller's project is untouched");
});

test("the screens that start a design from saved options strip the per-run settings, and none saves them back", () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
  const design = read("components/design/DesignView.jsx"), agent = read("components/design/WorkflowAgent.jsx"), service = read("services/biomniAgent.js");
  assert.match(design, /\.\.\.withoutRunOverrides\(currentProject\.options\),\s*\n\s*enzyme,/);
  assert.match(design, /options: \{ \.\.\.withoutRunOverrides\(currentProject\.options\), \.\.\.withoutRunOverrides\(options\) \}/);
  assert.match(agent, /\.\.\.withoutRunOverrides\(project\?\.options\),\s*\n\s*enzyme: enzymeId/);
  assert.match(agent, /options: withoutRunOverrides\(opts\)/);
  assert.match(service, /\.\.\.withoutRunOverrides\(currentProject\?\.options\),\s*\n\s*enzyme: intent\.enzyme,\s*\n\s*spacerLength/);
  for (const [name, src] of [["DesignView", design], ["WorkflowAgent", agent]]) assert.match(src, /import \{ withoutRunOverrides \} from "\.\.\/\.\.\/services\/runOptions\.js"/, name);
});
