// Records the live responses behind the isoform and viability checks for the bundled references, as test/fixtures/isoform-evidence.json, so the checks replay offline:
//   NODE_USE_ENV_PROXY=1 node scripts/record_isoform_fixtures.mjs
// Per gene: the isoform analysis (NCBI Datasets, reduced to what the app keeps), the Ensembl protein-coding transcripts, and the Open Targets documents.
import fs from "node:fs";
import { analyzeCommonIsoformExons } from "../src/services/biomniAgent.js";
import { fetchEnsemblCodingTranscripts } from "../src/services/isoformCoverage.js";
import { OPEN_TARGETS_API } from "../src/services/geneViability.js";

const genes = { TP53: "tp53-NG_017013.2.gb", DIPK2A: "dipk2a-region.gb" };
const out = { recordedAt: new Date().toISOString(), genes: {} };
const ot = async (query, variables) => (await (await fetch(OPEN_TARGETS_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) })).json()).data;
for (const [gene, file] of Object.entries(genes)) {
  const genbank = fs.readFileSync(new URL(`../public/references/${file}`, import.meta.url), "utf8");
  const isoformAnalysis = await analyzeCommonIsoformExons(gene, genbank, fetch);
  const ensembl = await fetchEnsemblCodingTranscripts(gene, fetch);
  const search = await ot(`query($q:String!){ search(queryString:$q, entityNames:["target"], page:{index:0,size:5}){ hits{ id name object{ ... on Target{ approvedSymbol } } } } }`, { q: gene });
  const id = search.search.hits.find((h) => h.object?.approvedSymbol === gene).id;
  const target = await ot(`query($id:String!){ meta{ dataVersion{ year month } } target(ensemblId:$id){ id approvedSymbol geneticConstraint{ constraintType exp obs oe oeLower oeUpper score } depMapEssentiality{ tissueName screens{ geneEffect } } } }`, { id });
  // the screens are reduced to rounded gene effects; nothing else of them is read
  for (const t of target.target.depMapEssentiality || []) t.screens = t.screens.map((s) => ({ geneEffect: Math.round(s.geneEffect * 100) / 100 }));
  out.genes[gene] = { file, isoformAnalysis, ensembl, openTargets: { search, target } };
  console.log(gene, "isoforms", isoformAnalysis.totalIsoforms, "genomic", Boolean(isoformAnalysis.genomic), "ensembl", ensembl.ok && ensembl.transcripts.length);
}
fs.writeFileSync(new URL("../test/fixtures/isoform-evidence.json", import.meta.url), JSON.stringify(out));
