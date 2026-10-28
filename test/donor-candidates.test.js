import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runDesign } from "../src/engine/design/designEngine.js";
import { generateDonorCandidates, buildDonorComparisonRequest, rankDonorCandidates, validateDonorComparison } from "../src/services/donorCandidates.js";
const raw = fs.readFileSync(new URL('../public/references/apoe-ensg00000130203.gb', import.meta.url), 'utf8').replace('FEATURES','COMMENT     Location: chromosome:GRCh38:19:44905754:44909393:1\nFEATURES');
const project = { gene: "APOE", mutation: "R176C", options: { enzyme: "spcas9", deliveryMethod: "rnp" }, genbankRaw: raw, designResult: runDesign('pm',raw,'R176C','','',{enzyme:'spcas9'}) };
let panel;
test("six independent APOE pairs and bounded refinement preserve the requested protein and do not pool alternatives", async () => {
  panel = await generateDonorCandidates(project);
  assert.equal(panel.candidates.length,6);
  assert.equal(new Set(panel.candidates.map(c=>c.result.gs[0].sp)).size,6);
  assert.ok(panel.candidates.every(c=>c.result.gs.length===1 && c.result.os.length===1 && c.result.os[0].proteinValidation.valid && c.eligible));
  const before=JSON.stringify(project);
  const refined=await generateDonorCandidates(project,panel);
  assert.equal(refined.candidates.length,12);
  assert.equal(refined.rounds,2);
  assert.equal(new Set(refined.candidates.map(c=>c.result.gs[0].sp+':'+c.result.os[0].od)).size,12);
  assert.equal(JSON.stringify(project),before);
  assert.ok(refined.candidates.every(c=>c.result.wA==='R' && c.result.an===176 && c.result.mA==='C'));
});
test("batch exports matched donor requests and exact chromosome annotations, and rejects stale source settings", async () => {
  const batch=await buildDonorComparisonRequest(project,panel,{ontologyTerm:'CL:0000679'});
  assert.equal(batch.candidates.length,6);
  assert.ok(batch.candidates.every(c=>c.request.variants.some(v=>v.position===44908822 && v.ref==='C' && v.alt==='T' && v.role==='intended')));
  assert.deepEqual(batch.annotation.exons[0],[44905753,44905841]);
  assert.equal(batch.annotation.splicePositions.length,6);
  await assert.rejects(buildDonorComparisonRequest({...project,mutation:'R176S'},panel,{ontologyTerm:'CL:0000679'}),/stale/);
});
const metrics=(rna,usage,site)=>({exonicRnaRelativeDelta:rna,annotatedUsageMaxDelta:usage,spliceSiteMaxDelta:site});
const fakePanel={candidates:[{id:'a',eligible:true},{id:'b',eligible:true},{id:'c',eligible:false}]};
const fakeReport={candidates:[{id:'a',status:'complete',metrics:metrics(1,1,1)},{id:'b',status:'complete',metrics:metrics(2,2,2)},{id:'c',status:'complete',metrics:metrics(0,0,0)}]};
test("regulatory dominance cannot rescue a candidate failing core checks",()=>{
 const ranked=rankDonorCandidates(fakePanel,fakeReport);assert.deepEqual(ranked.frontier,['a']);assert.equal(ranked.status,'Preferred for experimental validation');
});
test("tradeoffs remain explicit and missing or failed predictions cannot be treated as safe",()=>{
 const report=structuredClone(fakeReport);report.candidates[1].metrics=metrics(.5,2,2);
 assert.equal(rankDonorCandidates(fakePanel,report).status,'Trade-offs need review');
 report.candidates[1].metrics.exonicRnaRelativeDelta=null;
 assert.deepEqual(rankDonorCandidates(fakePanel,report).frontier,[]);
 report.candidates[1].status='failed';assert.equal(rankDonorCandidates(fakePanel,report).status,'Review incomplete');
 assert.equal(rankDonorCandidates(fakePanel,null).status,'Review incomplete');
});
test("completed comparison import rejects an exported request, wrong panel, and duplicate results",async()=>{
 const batch=await buildDonorComparisonRequest(project,panel,{ontologyTerm:'CL:0000679'});
 await assert.rejects(validateDonorComparison(batch,batch),/does not match/);
 const intended=batch.candidates[0].request.variants.filter(v=>v.role==='intended').map(v=>v.position-1);const start=Math.floor((Math.min(...intended)+Math.max(...intended))/2)-8192;
 const report={schema:'assured-alphagenome-comparison/1',requestId:batch.requestId,sourceId:batch.sourceId,modelVersion:'ALL_FOLDS',sdkVersion:'0.10.0',ontologyTerms:['CL:0000679'],annotation:batch.annotation,context:{start,end:start+16384},candidates:batch.candidates.map(c=>({id:c.id,requestId:c.request.requestId,status:'failed'}))};
 assert.equal(await validateDonorComparison(report,batch),report);
 const duplicate=structuredClone(report);duplicate.candidates[1]=duplicate.candidates[0];await assert.rejects(validateDonorComparison(duplicate,batch),/Duplicate/);
});

test("applying one pair clears old clone/guide evidence and exports that pair in the report and QC handoff", async () => {
  const { updateProject } = await import('../src/services/projectState.js');
  const { buildQcDesignSpec } = await import('../src/engine/design/qcExport.js');
  const { generateReportHtml } = await import('../src/services/designExport.js');
  const selected=panel.candidates[2];
  const next=updateProject({...project,qcResults:[{clone:'old clone'}],biomniReport:{old:true}}, {designResult:selected.result,biomniReport:null,donorCandidatePanel:{...panel,selectedId:selected.id}});
  assert.deepEqual(next.qcResults,[]);
  assert.equal(next.biomniReport,null);
  const qc=buildQcDesignSpec(next.designResult);
  assert.equal(qc.guides.length,1);
  assert.equal(qc.donors.length,1);
  const html=generateReportHtml(next,next.designResult);
  assert.match(html,/Guide–donor candidate comparison/);
  assert.match(html,/Selected pair: pair-3/);
  assert.match(html,/AlphaGenome predictions have not been completed/);
});

test("TP53 RefSeqGene preset uses an exact-sequence verified reverse mapping and automatically covers the transcript", async () => {
  const { resolveAlphaGenomeMapping } = await import('../src/services/alphaGenomeReview.js');
  const { buildCoveredDonorComparisonRequest, comparisonCoversAnnotation } = await import('../src/services/donorCandidates.js');
  const raw=fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb',import.meta.url),'utf8');
  const p={gene:'TP53',mutation:'R175H',options:{enzyme:'spcas9'},genbankRaw:raw,designResult:runDesign('pm',raw,'R175H','','',{enzyme:'spcas9'})};
  const mapping=await resolveAlphaGenomeMapping(p);
  assert.equal(mapping.referenceStart,7659779);assert.equal(mapping.orientation,-1);
  const candidates=await generateDonorCandidates(p);
  const options={ontologyTerm:'EFO:0009747',sequenceLength:16384};
  const narrow=await buildDonorComparisonRequest(p,candidates,options);
  assert.equal(comparisonCoversAnnotation(narrow),false);
  const batch=await buildCoveredDonorComparisonRequest(p,candidates,options);
  assert.equal(batch.candidates[0].request.sequenceLength,131072);
  assert.equal(comparisonCoversAnnotation(batch),true);
  assert.ok(batch.candidates[0].request.variants.some(v=>v.role==='intended' && v.position===7675088 && v.ref==='C' && v.alt==='T'));
  const altered=structuredClone(p);altered.designResult.gb.genomicSequence='A'+altered.designResult.gb.genomicSequence.slice(1);
  await assert.rejects(resolveAlphaGenomeMapping(altered),/differs/);
});
