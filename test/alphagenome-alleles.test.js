import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runDesign} from '../src/engine/design/designEngine.js';
import {buildQcDesignSpec} from '../src/engine/design/qcExport.js';
import {ALLELE_CONTEXT_LENGTHS,buildAlleleReviewBatch,buildCoveredAlleleReviewBatch,alleleReviewCoversAnnotation,validateAlleleReview,alleleReviewSource} from '../src/services/alphaGenomeAlleles.js';
import {validateEnvelope} from '../server/alphaGenomeCloud.js';
import {generateReportHtml} from '../src/services/designExport.js';
const raw=fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb',import.meta.url),'utf8');
const rc=s=>[...s].reverse().map(b=>({A:'T',C:'G',G:'C',T:'A'}[b])).join('');
const make=(type,tag='',mutation='')=>{const result=runDesign(type,raw,mutation,tag,400,{expectedGene:'TP53',deliveryMethod:'rnp',maxBlockingChanges:3});assert.ok(!result.err,result.err);return {gene:'TP53',genbankRaw:raw,designResult:result};};
const settings={ontologyTerm:'EFO:0009747'};

test('native reverse-strand knockout exports exact cut boundaries, coding annotation and a valid cloud envelope',async()=>{
 const p=make('ko');const b=await buildAlleleReviewBatch(p,settings);validateEnvelope(b);
 const r=b.candidates[0].request,cuts=p.designResult.gs.map(g=>g.cut).sort((a,b)=>a-b),origin=7659778,n=p.designResult.gb.genomicSequence.length;
 assert.deepEqual([r.edit.start,r.edit.end],[origin+n-cuts[1],origin+n-cuts[0]]);
 assert.equal(r.edit.inserted,'');assert.equal(r.annotation.strand,-1);
 assert.equal(r.edit.end-r.edit.start,cuts[1]-cuts[0]);assert.ok(r.annotation.codingExons.length);
 const changed=structuredClone(p);changed.designResult.gs[0].cut++;
 assert.notEqual(alleleReviewSource(changed),alleleReviewSource(p));assert.notEqual((await buildAlleleReviewBatch(changed,settings)).requestId,b.requestId);
});

test('large reporter review inserts only the cassette and replaces the stop codon, preserving separate arm blockers',async()=>{
 const p=make('ct','T2A-EGFP');const spec=buildQcDesignSpec(p.designResult);const d=spec.donors[0];const b=await buildAlleleReviewBatch(p,settings),r=b.candidates[0].request;
 assert.ok(d.insertBp>700);assert.equal(r.edit.inserted,rc(d.sequence.slice(d.arm5,d.arm5+d.insertBp)));
 assert.equal(r.edit.end-r.edit.start,3);assert.equal(r.edit.inserted.length,p.designResult.il);
 assert.ok(r.edit.inserted.length<d.sequence.length,'homology arms must not be inserted twice');validateEnvelope(b);
 for(const v of r.edit.blockers)assert.equal(r.reference.sequence[v.position-r.reference.start+1],v.ref);
});

test('internal insertions and N-terminal donors use the native integrated allele geometry',async()=>{
 for(const p of [make('it','SPOT','R175'),make('nt','N:EGFP-Linker')]){
  const b=await buildAlleleReviewBatch(p,settings),r=b.candidates[0].request;
  assert.equal(r.edit.end-r.edit.start,p.designResult.type==='it'?0:3);
  assert.equal(r.edit.inserted.length,p.designResult.il);validateEnvelope(b);
 }
});

test('missing mapping, annotation and excessive edit size cannot produce review-ready alleles',async()=>{
 const p=make('ko');await assert.rejects(buildAlleleReviewBatch({...p,genbankRaw:''},settings),/mapped/);
 const noExons={...p,designResult:{...p.designResult,gb:{...p.designResult.gb,exons:[]}}};await assert.rejects(buildAlleleReviewBatch(noExons,settings),/exon annotation/);
 const long={...p,designResult:{...p.designResult,gs:p.designResult.gs.map((g,i)=>({...g,cut:i?25000:1000}))}};
 await assert.rejects(buildAlleleReviewBatch(long,{...settings,sequenceLength:16384}),/edit size/);
});

test('a transcript larger than the default context escalates to the smallest context that still covers it',async()=>{
 const p=make('ko');
 const fits=await buildCoveredAlleleReviewBatch(p,settings);
 assert.equal(fits.candidates[0].request.sequenceLength,131072,'TP53 fits the default context');
 assert.ok(alleleReviewCoversAnnotation(fits));
 // A transcript spanning more than 131 kb must widen rather than report incomplete coverage.
 const wide=structuredClone(p);
 wide.designResult.gb.exons=[{start:0,end:200},{start:300000,end:300500}];
 const widened=await buildCoveredAlleleReviewBatch(wide,settings);
 assert.ok(widened.candidates[0].request.sequenceLength>131072);
 assert.ok(ALLELE_CONTEXT_LENGTHS.includes(widened.candidates[0].request.sequenceLength));
 assert.ok(alleleReviewCoversAnnotation(widened));
});

test('an unsupported context length is still refused',async()=>{
 const p=make('ko');
 await assert.rejects(buildAlleleReviewBatch(p,{...settings,sequenceLength:65536}),/context length/);
 for(const sequenceLength of ALLELE_CONTEXT_LENGTHS.filter(n=>n>=131072)) {
  const b=await buildAlleleReviewBatch(p,{...settings,sequenceLength});
  assert.equal(b.candidates[0].request.sequenceLength,sequenceLength);
 }
});

test('saved manuscript evidence binds to the exact allele and rejects missing modalities and stale design',async()=>{
 const p=make('ko'),b=await buildAlleleReviewBatch(p,settings),r=b.candidates[0].request;
 const report={schema:'assured-alphagenome-allele-review/1',status:'complete',evidenceType:'model-prediction',requestId:b.requestId,sourceId:b.sourceId,alleleRequestId:r.requestId,candidates:[{id:'edited-allele',status:'complete'}],ontologyTerms:r.ontologyTerms,modelVersion:'ALL_FOLDS',sdkVersion:'test',createdAt:'test',annotationFullyCovered:true,conclusion:'Target disruption supported by sequence',structuralEvidence:{deletedBp:47,insertedBp:0,codingBasesRemoved:47},targetTracks:r.requestedOutputs.map(output=>({output,name:'test',referenceMean:1,editedMean:1,signedRelativeChange:0,maxAbsDelta:0})),neighborStatus:'unavailable',neighborTracks:[],limitations:['Protein loss unconfirmed.']};
 assert.equal(validateAlleleReview(report,b),report);
 assert.throws(()=>validateAlleleReview({...report,targetTracks:report.targetTracks.slice(1)},b),/missing/);
 assert.throws(()=>validateAlleleReview({...report,requestId:'wrong'},b),/match/);
 const saved={...p,alleleReview:report,alleleReviewContext:settings.ontologyTerm,alleleReviewSource:alleleReviewSource(p)};
 assert.match(generateReportHtml(saved,p.designResult),/matching retained regions; deleted bases excluded/);
 const stale={...saved,designResult:{...p.designResult,gs:[]}};
 assert.match(generateReportHtml(stale,stale.designResult),/excluded. Run a new review/);
});
