import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseBiomniPrompt,
  buildBiomniPlan,
  computeClonalScreeningPower,
  runBiomniCoScientist,
} from "../src/services/biomniAgent.js";

const tp53Raw = readFileSync(new URL("../public/references/tp53-NG_017013.2.gb", import.meta.url), "utf8");
const apoeRaw = readFileSync(new URL("./fixtures/reference_demo.gb", import.meta.url), "utf8");
const dipk2aRaw = readFileSync(new URL("../public/references/dipk2a-region.gb", import.meta.url), "utf8");

test("parseBiomniPrompt extracts gene, editType, mutation, tag, enzyme, and tool flags", () => {
  const snp = parseBiomniPrompt("Design R175H point mutation knock-in for TP53, check ClinVar, and compare all enzymes");
  assert.equal(snp.gene, "TP53");
  assert.equal(snp.editType, "pm");
  assert.equal(snp.mutation, "R175H");
  assert.equal(snp.wantsClinvar, true);
  assert.equal(snp.wantsEnzymeCompare, true);

  const ko = parseBiomniPrompt("Design a knockout for APOE and rank exon guides with Lindel");
  assert.equal(ko.gene, "APOE");
  assert.equal(ko.editType, "ko");
  assert.equal(ko.wantsLindel, true);

  const ct = parseBiomniPrompt("Design a C-terminal 2xHA tag knock-in for LMNA using Mad7");
  assert.equal(ct.gene, "LMNA");
  assert.equal(ct.editType, "ct");
  assert.equal(ct.tag, "2xHA-only");
  assert.equal(ct.enzyme, "mad7");
});

test("buildBiomniPlan builds ordered multi-step ASSURED-E1 plan", () => {
  const intent = parseBiomniPrompt("Design R175H point mutation knock-in for TP53 and compare all enzymes");
  const plan = buildBiomniPlan(intent);
  const tools = plan.map(p => p.tool);
  assert.ok(tools.includes("fetch_gene_reference"));
  assert.ok(tools.includes("query_uniprot_protein"));
  assert.ok(tools.includes("search_clinvar_variants"));
  assert.ok(tools.includes("design_crispr_edit"));
  assert.ok(tools.includes("compare_crispr_enzymes"));
  assert.ok(tools.includes("compute_screening_power"));
});

test("computeClonalScreeningPower computes 96-well clonal screening power", () => {
  const power = computeClonalScreeningPower({
    editType: "ko",
    lindelTopGuide: { predicted_LoF_allele_pct: 85 },
    deliveryEfficiency: 0.8,
  });
  assert.equal(power.ok, true);
  assert.ok(power.recommendedClonesToScreen >= 4 && power.recommendedClonesToScreen <= 40);
  assert.equal(power.plates96Well, 1);
});

test("runBiomniCoScientist executes end-to-end KO + Lindel ranking and PM + enzyme comparison", async () => {
  const mockFetch = async (url) => {
    if (String(url).includes("dipk2a-region.gb")) {
      return { ok: true, text: async () => dipk2aRaw };
    }
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            primaryAccession: "P02649",
            proteinDescription: { recommendedName: { fullName: { value: "Apolipoprotein E" } } },
            sequence: { length: 317 },
            comments: [{ commentType: "FUNCTION", texts: [{ value: "Mediates lipid transport." }] }],
            features: [{ type: "Domain", description: "LDL-receptor binding", location: { start: { value: 140 }, end: { value: 160 } } }],
          },
        ],
      }),
    };
  };

  // Test DIPK2A KO with empty project genbankRaw (auto-resolves dipk2a-region.gb)
  const dipkRes = await runBiomniCoScientist(
    "Design a biallelic knockout for DIPK2A and rank exon guides with Lindel",
    { id: "p0", gene: "TP53", genbankRaw: "", options: { enzyme: "spcas9" } },
    { fetchFn: mockFetch }
  );
  assert.equal(dipkRes.intent.gene, "DIPK2A");
  assert.equal(dipkRes.steps.every(s => s.status === "completed"), true);
  assert.ok(dipkRes.designResult && dipkRes.designResult.gs.length === 2);
  assert.ok(dipkRes.lindelRanking && dipkRes.lindelRanking.totalCandidates > 0);
  assert.equal(dipkRes.lindelRanking.topGuides[0].coding_exon, 2);
  assert.equal(dipkRes.lindelRanking.topGuides[0].panel_tier, "robust");
  assert.equal(dipkRes.lindelRanking.topGuides[0].is_common_exon, true);
  assert.ok(dipkRes.lindelRanking.topGuides[0].predicted_LoF_allele_pct > 80);

  const koRes = await runBiomniCoScientist(
    "Design a biallelic knockout for APOE and rank exon guides with Lindel",
    { id: "p1", gene: "APOE", genbankRaw: apoeRaw, options: { enzyme: "spcas9" } },
    { fetchFn: mockFetch }
  );
  assert.equal(koRes.schema, "assured-biomni-coscientist/1");
  assert.equal(koRes.intent.gene, "APOE");
  assert.equal(koRes.intent.editType, "ko");
  assert.ok(koRes.designResult && koRes.designResult.gs.length === 2);
  assert.ok(koRes.lindelRanking && koRes.lindelRanking.totalCandidates > 0);
  assert.equal(koRes.uniprot.accession, "P02649");
  assert.ok(koRes.screeningPower.recommendedClonesToScreen > 0);

  const pmRes = await runBiomniCoScientist(
    "Design R175H point mutation knock-in for TP53 and compare all enzymes",
    { id: "p2", gene: "TP53", genbankRaw: tp53Raw, options: { enzyme: "spcas9" } },
    { fetchFn: mockFetch }
  );
  assert.equal(pmRes.intent.gene, "TP53");
  assert.equal(pmRes.intent.editType, "pm");
  assert.equal(pmRes.intent.mutation, "R175H");
  assert.ok(pmRes.designResult && pmRes.designResult.gs.length > 0);
  assert.ok(pmRes.enzymeComparison && pmRes.enzymeComparison.candidates.length === 7);
});
