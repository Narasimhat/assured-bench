import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runDesign} from '../src/engine/design/designEngine.js';
import {designAndReviewStructural,prepareStructuralAlternatives,rankStructuralAlternatives,structuralMetrics,saveStructuralAlternatives,applyStructuralAlternative} from '../src/services/structuralAlternatives.js';
const raw=fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb',import.meta.url),'utf8');
const settings={ontology:'EFO:0009747',reporter:'T2A-EGFP',terminalRequirement:'neither'};
function project(type){const r=runDesign(type,raw,'','T2A-EGFP',400,{expectedGene:'TP53',deliveryMethod:'rnp',maxBlockingChanges:3});assert.ok(!r.err,r.err);return{gene:'TP53',genbankRaw:raw,designResult:r};}
function evidence(candidate,rna=.1,usage=.01,sites=.02,neighbor=.1){const req=candidate.batch?.candidates[0].request;return {schema:'assured-alphagenome-allele-review/1',status:'complete',evidenceType:'model-prediction',annotationFullyCovered:true,requestId:candidate.batch?.requestId,sourceId:candidate.batch?.sourceId,alleleRequestId:req?.requestId,ontologyTerms:req?.ontologyTerms,comparisonContext:req?.comparisonContext,candidates:[{id:'edited-allele',status:'complete'}],modelVersion:'ALL_FOLDS',sdkVersion:'test',neighborStatus:'available',neighborTracks:[{output:'RNA_SEQ',referenceMean:1,editedMean:1,signedRelativeChange:0,maxAbsDelta:neighbor,annotationFullyCovered:false}],targetTracks:[{output:'RNA_SEQ',name:'rna',referenceMean:1,editedMean:1+rna,signedRelativeChange:rna,maxAbsDelta:Math.abs(rna)},{output:'SPLICE_SITE_USAGE',name:'usage',maxAbsDelta:usage},{output:'SPLICE_SITES',name:'site',maxAbsDelta:sites}]};}

test('N/C and guide alternatives preserve the same 2A reporter purpose, context and retained mask',async()=>{
 const p=project('ct'),plan=await prepareStructuralAlternatives(p,settings);
 assert.equal(plan.candidates.length,6);assert.equal(plan.candidates[0].result.type,'nt');assert.equal(plan.candidates[1].result.type,'ct');
 assert.ok(plan.candidates.every(c=>c.result.tag==='T2A-EGFP'&&c.result.insertValidation.framePreserved));
 assert.ok(plan.candidates.every(c=>JSON.stringify(c.batch.candidates[0].request.comparisonContext)===JSON.stringify(plan.comparisonContext)));
 assert.ok(plan.comparisonContext.exclusions.some(([a,b])=>b-a>700),'the common cropped tail is excluded');
 const saved=saveStructuralAlternatives(plan);assert.ok(saved.candidates.every(c=>!c.result&&!c.batch&&c.recipe));assert.ok(!JSON.stringify(saved.candidates).includes('"reference"'),'candidate recipes do not duplicate genomic references');
 const restored=await prepareStructuralAlternatives(p,settings,saved);assert.deepEqual(restored.candidates.map(c=>c.batch.requestId),plan.candidates.map(c=>c.batch.requestId));
 const changed={...p,gene:'OTHER'};await assert.rejects(prepareStructuralAlternatives(changed,settings,saved),/different design/);
});

test('knockout alternatives remain native robust frameshift pairs and carry real Lindel evidence when available',async()=>{
 const plan=await prepareStructuralAlternatives(project('ko'),settings);
 assert.equal(plan.candidates.length,6);assert.ok(plan.candidates.every(c=>c.result.gs.length===2&&c.result.deletionOutcome.frameshiftPredicted&&c.nativeTier==='robust'));
 assert.ok(plan.candidates.every(c=>Number.isFinite(c.nativeLof)));
});

test('terminal requirements block incompatible arrangements; unknown requirements prevent an overall N/C winner',async()=>{
 const p=project('ct'),plan=await prepareStructuralAlternatives(p,{...settings,terminalRequirement:'preserve-n'});
 assert.ok(plan.candidates.filter(c=>c.result.type==='nt').every(c=>!c.eligible));
 assert.ok(plan.candidates.some(c=>c.result.type==='ct'&&c.eligible));
 const base=await prepareStructuralAlternatives(p,settings);base.candidates=base.candidates.slice(0,2);
 base.candidates.forEach((c,i)=>c.review=evidence(c,i?.2:.1,i?.02:.01,i?.04:.02,i?.2:.1));
 assert.equal(rankStructuralAlternatives(base).status,'Prefer N-terminal');
 base.settings.terminalRequirement='unknown';assert.equal(rankStructuralAlternatives(base).recommendedId,null);
});

test('trade-offs and incomplete model or neighbour evidence do not become a best-design claim',()=>{
 const a={id:'a',eligible:true,result:{type:'nt'},nativeLof:90},b={id:'b',eligible:true,result:{type:'ct'},nativeLof:90};
 a.review=evidence(a,.05,.1,.1,.1);b.review=evidence(b,.1,.05,.05,.05);
 const plan={mode:'2a',settings:{terminalRequirement:'neither'},candidates:[a,b]};
 assert.deepEqual(rankStructuralAlternatives(plan).frontier,['a','b']);assert.equal(rankStructuralAlternatives(plan).recommendedId,null);
 b.review=null;assert.equal(rankStructuralAlternatives(plan).frontier.length,0);
 b.review=evidence(b);a.review.neighborStatus='unavailable';assert.equal(rankStructuralAlternatives(plan).recommendedId,null);
 a.review.annotationFullyCovered=false;assert.equal(structuralMetrics(a.review),null);
});

test('knockout ranking uses remaining target RNA, not increasing splice disruption, and application preserves validation gates',async()=>{
 const p=project('ko'),plan=await prepareStructuralAlternatives(p,settings);plan.candidates=plan.candidates.slice(0,2);
 const [a,b]=plan.candidates;a.review=evidence(a,-.4,.01,.01,.01);b.review=evidence(b,-.1,.9,.9,.1);a.nativeLof=b.nativeLof=90;
 assert.equal(rankStructuralAlternatives(plan).recommendedId,a.id);
 const fields=applyStructuralAlternative(p,plan,a.id);assert.equal(fields.designResult.gs[0].sp,a.result.gs[0].sp);assert.notEqual(fields.status,'ready');assert.equal(fields.alleleReview,null);assert.ok(fields.svgScheme);
 assert.throws(()=>applyStructuralAlternative({...p,gene:'changed'},plan,a.id),/changed/);
});

test('a failed candidate remains incomplete and a resumed run reuses successful evidence',async()=>{
 const {reviewStructuralAlternatives}=await import('../src/services/structuralAlternatives.js');
 const request=(id)=>({requestId:id,sourceId:'source',candidates:[{request:{requestId:`allele-${id}`,ontologyTerms:['EFO:0009747'],requestedOutputs:['RNA_SEQ','SPLICE_SITES','SPLICE_SITE_USAGE']}}]});
 const a={id:'a',eligible:true,result:{type:'ct'},batch:request('a')},b={id:'b',eligible:true,result:{type:'nt'},batch:request('b')};
 const plan={mode:'2a',settings:{terminalRequirement:'neither'},candidates:[a,b]};let calls=0,fail=true;
 const fetchFn=async(url,init)=>{calls++;const data=JSON.parse(init.body);if(data.requestId==='b'&&fail)return new Response(JSON.stringify({error:'Prediction unavailable'}),{status:502});const c=data.requestId==='a'?a:b;return new Response(JSON.stringify(evidence(c)),{status:200});};
 await reviewStructuralAlternatives(plan,{fetchFn});assert.equal(calls,2);assert.ok(a.review);assert.ok(!b.review);assert.equal(rankStructuralAlternatives(plan).recommendedId,null);
 fail=false;await reviewStructuralAlternatives(plan,{fetchFn});assert.equal(calls,3);assert.ok(b.review);
 b.review.targetTracks[0].comparedBases=42;assert.equal(rankStructuralAlternatives(plan).recommendedId,null,'unequal compared regions cannot support a preference');
});

test('2A reporter schemes describe the encoded ORF without claiming a single mature fusion protein',()=>{
 const result=project('ct').designResult;
 // The same renderer is used by the selected design and publication manuscript.
 return import('../src/engine/design/designScheme.js').then(({buildDesignSchemeSvg,buildDesignSchemeCaption})=>{
  assert.match(buildDesignSchemeSvg(result),/2A skipping expected/);assert.doesNotMatch(buildDesignSchemeSvg(result),/Tagged protein:/);
  assert.match(buildDesignSchemeCaption(result),/not a single mature fusion protein/);
 });
});


test('initial design-page comparison retains reviewed alternatives without inventing a terminal preference',async()=>{
 const p=project('ct');let calls=0;
 const fields=await designAndReviewStructural(p,{...settings,terminalRequirement:'unknown'},{fetchFn:async(url,init)=>{
  calls++;return new Response(JSON.stringify(evidence({batch:JSON.parse(init.body)},calls/100,calls/100,calls/100,calls/100)));
 }});
 assert.ok(calls>=2);
 assert.equal(fields.designResult,undefined);
 assert.equal(fields.alleleReviewContext,settings.ontology);
 assert.ok(fields.structuralAlternatives.candidates.filter(c=>c.eligible).every(c=>c.review?.status==='complete'));
 assert.equal(fields.structuralAlternatives.settings.reporter,p.designResult.tag);
});
