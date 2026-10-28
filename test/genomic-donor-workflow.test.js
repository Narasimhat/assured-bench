import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designGenomicSnp } from '../src/engine/design/genomicSnp.js';
import { normalizeGenomicDesign } from '../src/services/genomicDesignResult.js';
import { generateDonorCandidates, buildCoveredDonorComparisonRequest, donorSourceId } from '../src/services/donorCandidates.js';
import { assembleGenomicPairs } from '../src/services/genomicDonorCandidates.js';
import { buildTwoPairResult, designAndReviewDonors } from '../src/services/donorWorkflow.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { generateReportHtml } from '../src/services/designExport.js';
const raw=fs.readFileSync(new URL('../public/references/apoe-ensg00000130203.gb',import.meta.url),'utf8').replace('FEATURES','COMMENT     Location: chromosome:GRCh38:19:44905754:44909393:1\nFEATURES');
const input={gene:'APOE',assembly:'GRCh38',chromosome:'19',referenceStart:44905754,position:44908822,ref:'C',alt:'T',forwardConfirmed:true,blockingPolicy:'independent',cellLine:'WTC11'};
const project={gene:'APOE',mutation:'chr19:44908822 C>T',genomicDesignInput:{genbankRaw:raw,input},designResult:normalizeGenomicDesign(designGenomicSnp(raw,input))};
let panel;
test('genomic alternatives retain the exact two baseline donors and build six matched candidates',async()=>{
 panel=await generateDonorCandidates(project); assert.equal(panel.candidates.length,6);
 assert.equal(panel.candidates.filter(c=>c.baseline).length,2);
 assert.deepEqual(panel.candidates.slice(0,2).map(c=>c.result.os[0].od),project.designResult.os.map(d=>d.od));
 const batch=await buildCoveredDonorComparisonRequest(project,panel,{ontologyTerm:'EFO:0009747',sequenceLength:16384});
 assert.equal(batch.annotation.strand,1);assert.equal(batch.annotation.exons.length,4);
 for(const c of batch.candidates) assert.deepEqual(c.request.variants.filter(v=>v.role==='intended'),[{position:44908822,ref:'C',alt:'T',role:'intended'}]);
});
test('a genomic coordinate, reference or blocking policy change invalidates saved evidence',async()=>{
 for(const change of [{position:44908823},{blockingPolicy:'none'}]) assert.notEqual(await donorSourceId(project),await donorSourceId({...project,genomicDesignInput:{...project.genomicDesignInput,input:{...input,...change}}}));
 assert.notEqual(await donorSourceId(project),await donorSourceId({...project,genomicDesignInput:{...project.genomicDesignInput,genbankRaw:raw+'\n'}}));
});
test('joint genomic donors protect both guides, preserve the intended SNP and export exactly two donors',()=>{
 const result=buildTwoPairResult(project,panel,['pair-1','pair-2'],true);
 assert.equal(result.type,'genomic-snv');assert.equal(result.coDeliverySafe,true);
 assert.ok(result.os.every(d=>d.guideProtection.length===2&&d.guideProtection.every(p=>p.tier==='strong')));
 assert.ok(result.os.every(d=>d.genomicDonor[result.gp-d.donorStart]==='T'));
 const spec=buildQcDesignSpec(result);assert.ok(!spec.err,spec.err);assert.equal(spec.donors.length,2);
 assert.ok(spec.markers.some(m=>m.role==='intended'));
 assert.ok(result.dualCutDeletionRisk);
 assert.throws(()=>assembleGenomicPairs([{result,donorIndex:0},{result,donorIndex:0}]),/different guide/);
});
test('no exon annotation cannot produce a complete transcript-based preference',async()=>{
 const noExons=raw.replace(/^     exon[\s\S]*?(?=^     \S|^ORIGIN)/gm,'');
 const other={...project,genomicDesignInput:{genbankRaw:noExons,input},designResult:normalizeGenomicDesign(designGenomicSnp(noExons,input))};
 const candidates=await generateDonorCandidates(other);
 await assert.rejects(()=>buildCoveredDonorComparisonRequest(other,candidates,{ontologyTerm:'EFO:0009747'}),/Exon annotations/);
});
test('the full genomic workflow separately reviews rebuilt final alleles and reports the selected two',async()=>{
 const batches=[];
 const fetchFn=async(url,init)=>{
  const batch=JSON.parse(init.body);batches.push(batch);const req=batch.candidates[0].request,p=req.variants.find(v=>v.role==='intended').position-1,start=p-req.sequenceLength/2;
  return {ok:true,json:async()=>({schema:'assured-alphagenome-comparison/1',requestId:batch.requestId,sourceId:batch.sourceId,annotation:batch.annotation,ontologyTerms:req.ontologyTerms,modelVersion:'ALL_FOLDS',sdkVersion:'test',context:{start,end:start+req.sequenceLength},candidates:batch.candidates.map(c=>({id:c.id,requestId:c.request.requestId,status:'complete',metrics:{exonicRnaRelativeDelta:.01,annotatedUsageMaxDelta:.01,spliceSiteMaxDelta:.01},localizedTracks:['RNA_SEQ','SPLICE_SITE_USAGE','SPLICE_SITES'].map(output=>({output,topChanges:[{position:input.position,before:1,after:1.01,delta:.01}]}))}))})};
 };
 const fields=await designAndReviewDonors(project,{ontology:'EFO:0009747',protectBoth:true},{fetchFn});
 assert.equal(batches.at(-1).candidates.length,2);assert.ok(fields.donorCandidatePanel.finalReview);
 assert.equal(fields.designResult.gs.length,2);assert.equal(fields.designResult.os.length,2);
 const html=generateReportHtml({...project,...fields},fields.designResult);assert.match(html,/Final rebuilt donor alleles/);assert.match(html,/genomic substitution/);
});
test('reverse-strand genomic SNPs retain forward genomic alleles and the transcript strand',async()=>{
 const reverseRaw=fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb',import.meta.url),'utf8').replace('FEATURES','COMMENT     Location: chromosome:GRCh38:17:7659779:7692550:-1\nFEATURES');
 const reverseInput={...input,gene:'TP53',chromosome:'17',referenceStart:7659779,position:7675088,ref:'C',alt:'T',forwardConfirmed:false};
 const reverseProject={gene:'TP53',mutation:'chr17:7675088 C>T',genomicDesignInput:{genbankRaw:reverseRaw,input:reverseInput},designResult:normalizeGenomicDesign(designGenomicSnp(reverseRaw,reverseInput))};
 assert.ok(!reverseProject.designResult.err,reverseProject.designResult.err);
 const panel=await generateDonorCandidates(reverseProject);
 const batch=await buildCoveredDonorComparisonRequest(reverseProject,panel,{ontologyTerm:'EFO:0009747',sequenceLength:16384});
 assert.equal(batch.annotation.strand,-1);assert.equal(batch.candidates[0].request.sequenceLength,131072);
 for(const c of batch.candidates) assert.deepEqual(c.request.variants.filter(v=>v.role==='intended'),[{position:7675088,ref:'C',alt:'T',role:'intended'}]);
});
test('an intronic genomic SNP stays an exact nucleotide substitution rather than an inferred protein mutation',async()=>{
 const position=44908450;
 const seq=project.designResult.gb.genomicSequence;
 const ref=seq[position-input.referenceStart],alt=ref==='A'?'G':'A';
 const intronicInput={...input,position,ref,alt};
 const result=normalizeGenomicDesign(designGenomicSnp(raw,intronicInput));
 assert.ok(!result.err,result.err);
 const p={...project,mutation:`chr19:${position} ${ref}>${alt}`,genomicDesignInput:{genbankRaw:raw,input:intronicInput},designResult:result};
 const candidates=await generateDonorCandidates(p);
 const batch=await buildCoveredDonorComparisonRequest(p,candidates,{ontologyTerm:'EFO:0009747',sequenceLength:16384});
 assert.ok(batch.annotation.exons.every(([a,b])=>!(a<=position-1 && position-1<b)));
 for(const c of batch.candidates) assert.deepEqual(c.request.variants.filter(v=>v.role==='intended'),[{position,ref,alt,role:'intended'}]);
});
