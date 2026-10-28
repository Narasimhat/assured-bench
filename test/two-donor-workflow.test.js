import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runDesign,assemblePointMutationPairs} from '../src/engine/design/designEngine.js';
import {buildQcDesignSpec} from '../src/engine/design/qcExport.js';
import {generateDonorCandidates,donorSourceId} from '../src/services/donorCandidates.js';
import {suggestTwoDonorCandidates,buildTwoPairResult,selectTwoReviewedDesigns,designAndReviewDonors} from '../src/services/donorWorkflow.js';
import {generateReportHtml} from '../src/services/designExport.js';
const raw=fs.readFileSync(new URL('../public/references/apoe-ensg00000130203.gb',import.meta.url),'utf8').replace('FEATURES','COMMENT     Location: chromosome:GRCh38:19:44905754:44909393:1\nFEATURES');
const project={gene:'APOE',mutation:'R176C',genbankRaw:raw,options:{enzyme:'spcas9',deliveryMethod:'rnp'},designResult:runDesign('pm',raw,'R176C','','',{enzyme:'spcas9'})};
const metrics={exonicRnaRelativeDelta:.01,annotatedUsageMaxDelta:.01,spliceSiteMaxDelta:.01};
let panel;
const mockFetch=async(url,init)=>{
 const batch=JSON.parse(init.body),req=batch.candidates[0].request,p=req.variants.filter(v=>v.role==='intended').map(v=>v.position-1),start=Math.floor((Math.min(...p)+Math.max(...p))/2)-req.sequenceLength/2;
 return {ok:true,json:async()=>({schema:'assured-alphagenome-comparison/1',sourceId:batch.sourceId,requestId:batch.requestId,annotation:batch.annotation,ontologyTerms:req.ontologyTerms,modelVersion:'ALL_FOLDS',sdkVersion:'test',createdAt:'test',context:{start,end:start+req.sequenceLength},candidates:batch.candidates.map(c=>({id:c.id,requestId:c.request.requestId,status:'complete',metrics,localizedTracks:['RNA_SEQ','SPLICE_SITE_USAGE','SPLICE_SITES'].map(output=>({output,topChanges:[{position:44908822,before:1,after:1.01,delta:.01}]}))}))})};
};
test('the original two exact donors are preserved and labelled as baselines',async()=>{
 panel=await generateDonorCandidates(project);assert.equal(panel.candidates.filter(c=>c.baseline).length,2);
 for(let i=0;i<2;i++){assert.equal(panel.candidates[i].result.os[0].od,project.designResult.os[i].od);assert.equal(panel.candidates[i].result.gs[0].sp,project.designResult.gs[i].sp)}
});
test('two selected pairs retain exact donors and have a complete cross-guide matrix and deletion warning',()=>{
 const result=buildTwoPairResult(project,panel,['pair-1','pair-2']);assert.equal(result.gs.length,2);assert.equal(result.os.length,2);
 assert.deepEqual(result.os.map(d=>d.od),project.designResult.os.map(d=>d.od));
 assert.ok(result.os.every(d=>d.guideProtection.length===2));assert.equal(result.coDeliverySafe,false);
 assert.ok(result.dualCutDeletionRisk.spans[0]>0);
 const qc=buildQcDesignSpec(result);assert.equal(qc.guides.length,2);assert.equal(qc.donors.length,2);
 assert.throws(()=>buildTwoPairResult(project,panel,['pair-1','pair-1']),/different/);
});
test('optional joint protection reconstructs both donors and preserves the intended protein',()=>{
 const result=buildTwoPairResult(project,panel,['pair-1','pair-2'],true);
 assert.equal(result.coDeliveryBlockingRequested,true);assert.equal(result.coDeliverySafe,true);
 assert.ok(result.os.every(d=>d.proteinValidation.valid && d.guideProtection.every(g=>g.tier==='strong')));
 assert.notDeepEqual(result.os.map(d=>d.od),project.designResult.os.map(d=>d.od));
 const one=assemblePointMutationPairs([{result,donorIndex:1}]);assert.equal(one.gs.length,1);assert.equal(one.os[0].od,result.os[1].od);
});
test('one action reviews/refines and returns exactly two distinct guides and two matched donors',async()=>{
 const fields=await designAndReviewDonors(project,{ontology:'CL:0000679',protectBoth:false},{fetchFn:mockFetch});
 assert.equal(fields.designResult.gs.length,2);assert.equal(fields.designResult.os.length,2);assert.equal(new Set(fields.designResult.gs.map(g=>g.sp)).size,2);
 assert.equal(fields.donorCandidatePanel.selectedIds.length,2);assert.equal(fields.donorCandidatePanel.selectionReviewed,true);
 const html=generateReportHtml({...project,...fields},fields.designResult);assert.match(html,/Selected pairs:/);assert.match(html,/Independent protection/);
});
test('joint mode runs a separate review on the final rebuilt alleles',async()=>{
 const calls=[];const fetchFn=async(...args)=>{calls.push(JSON.parse(args[1].body));return mockFetch(...args)};
 const fields=await designAndReviewDonors(project,{ontology:'CL:0000679',protectBoth:true},{fetchFn});
 assert.equal(calls.length,3);assert.equal(calls[2].candidates.length,2);
 assert.ok(fields.designResult.os.every(d=>d.guideProtection.every(g=>g.tier==='strong')));
 assert.equal(fields.donorCandidatePanel.finalReview.candidates.length,2);
 const html=generateReportHtml({...project,...fields},fields.designResult);assert.match(html,/Final rebuilt donor alleles/);assert.match(html,/not these rebuilt final donors/);
});
test('missing model evidence and stale inputs cannot apply a selected pair',async()=>{
 const p={...panel,ontology:'CL:0000679',review:{candidates:[]}};
 await assert.rejects(selectTwoReviewedDesigns(project,p,['pair-1','pair-2'],{ontology:'CL:0000679',protectBoth:false}),/complete AlphaGenome/);
 await assert.rejects(selectTwoReviewedDesigns({...project,mutation:'R176S'},p,['pair-1','pair-2'],{ontology:'CL:0000679',protectBoth:false}),/current source/);
});

test('reviewing again after selection retains the original baseline donor sequences',async()=>{
 const replacement=buildTwoPairResult(project,panel,['pair-3','pair-4']);
 const p={...project,designResult:replacement,donorCandidatePanel:panel};
 const again=await generateDonorCandidates(p);
 assert.deepEqual(again.candidates.filter(c=>c.baseline).map(c=>c.result.os[0].od),panel.candidates.filter(c=>c.baseline).map(c=>c.result.os[0].od));
});
