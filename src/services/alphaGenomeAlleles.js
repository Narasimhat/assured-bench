import { buildQcDesignSpec } from '../engine/design/qcExport.js';
import { resolveAlphaGenomeMapping, reviewRequestId } from './alphaGenomeReview.js';

export const STRUCTURAL_REVIEW_TYPES = ['ko', 'ct', 'nt', 'it'];
/** AlphaGenome prediction contexts, smallest first. Large loci need the long contexts to fit a whole transcript. */
export const ALLELE_CONTEXT_LENGTHS = [16384, 131072, 524288, 1048576];
const rc = s => [...s].reverse().map(b => ({A:'T',C:'G',G:'C',T:'A',N:'N'}[b])).join('');

/** Review the integrated allele, never the donor's homology arms as an insertion. */
export async function buildAlleleReviewBatch(project, {ontologyTerm, donorIndex=0, sequenceLength=131072, comparisonContext=null}={}) {
  const result=project.designResult;
  if (!result || result.err || !STRUCTURAL_REVIEW_TYPES.includes(result.type)) throw new Error('Generate a knockout or tag/reporter knock-in first.');
  const mapping=await resolveAlphaGenomeMapping(project);
  if (!mapping || mapping.assembly!=='GRCh38') throw new Error('Fetch a mapped human GRCh38 reference before reviewing this allele.');
  if (!/^(CL|EFO|UBERON):\d+$/.test(ontologyTerm||'')) throw new Error('Choose the experimental cell context.');
  if (!ALLELE_CONTEXT_LENGTHS.includes(sequenceLength)) throw new Error('Unsupported context length.');
  const reference=result.gb?.genomicSequence?.toUpperCase();
  if (!reference || reference.length>1000000 || !/^[ACGTN]+$/.test(reference)) throw new Error('A valid genomic reference of at most 1 Mb is required.');
  const spec=buildQcDesignSpec(result,{maxWindow:1000000});
  if(spec.err)throw new Error(spec.err);
  const offset=spec.reference.offset;
  let from,to,inserted='',blockers=[],donor='defined-deletion';
  if(result.type==='ko') {
    const cuts=(result.gs||[]).map(g=>g.cut).sort((a,b)=>a-b);
    if(cuts.length!==2 || cuts.some(c=>!Number.isInteger(c)) || cuts[0]>=cuts[1]) throw new Error('Exactly two distinct cut coordinates are required for a defined deletion review.');
    [from,to]=cuts;
  } else {
    const d=spec.donors?.[donorIndex];
    if(!Number.isInteger(donorIndex)||!d||!Number.isInteger(d.insertBp)||d.insertBp<1)throw new Error('Choose a matched insertion donor.');
    if(d.sequence.length!==d.arm5+d.insertBp+d.arm3 || d.refEnd-d.refStart!==d.arm5+d.replacedBp+d.arm3)throw new Error('Insertion donor geometry is inconsistent.');
    from=d.insertStart+offset;to=from+d.replacedBp;
    inserted=d.sequence.slice(d.arm5,d.arm5+d.insertBp);donor=d.name;
    if(inserted.length!==d.insertBp || !/^[ACGT]+$/.test(inserted))throw new Error('The complete cassette sequence is required.');
    blockers=(spec.markers||[]).filter(m=>m.pos>=d.refStart && m.pos<d.refEnd && (!d.carriesMarkers || d.carriesMarkers.includes(m.pos))).map(m=>({index:m.pos+offset,ref:m.ref,alt:m.alt}));
  }
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>reference.length||from>to)throw new Error('Edit boundaries are outside the genomic reference.');
  if(Math.max(to-from,inserted.length)>sequenceLength/4)throw new Error('This allele exceeds the supported edit size for the selected prediction window.');
  const absolute=(a,b)=>mapping.orientation===1?[mapping.referenceStart-1+a,mapping.referenceStart-1+b]:[mapping.referenceStart-1+reference.length-b,mapping.referenceStart-1+reference.length-a];
  const [start,end]=absolute(from,to);
  blockers=blockers.map(b=>{
    if(!/^[ACGT]$/.test(b.ref)||!/^[ACGT]$/.test(b.alt)||reference[b.index]!==b.ref||b.index>=from&&b.index<to)throw new Error('An arm blocker conflicts with the intended insertion.');
    return {position:absolute(b.index,b.index+1)[0],ref:mapping.orientation===1?b.ref:rc(b.ref),alt:mapping.orientation===1?b.alt:rc(b.alt)};
  }).sort((a,b)=>a.position-b.position);
  const model=result.gb;
  const exons=(model.exons||[]).map(e=>absolute(e.start,e.end)).sort((a,b)=>a[0]-b[0]);
  if(!exons.length)throw new Error('Transcript exon annotation is required; fetch a complete annotated reference.');
  const codingExons=(model.cdsSegments||[]).map(([a,b])=>absolute(a,b)).sort((a,b)=>a[0]-b[0]);
  const requestPayload={schema:'assured-alphagenome-allele-request/1',assembly:'GRCh38',chromosome:`chr${String(mapping.chromosome).replace(/^chr/i,'')}`,gene:result.gene||project.gene||'Locus',designKind:result.type,donor,
    reference:{start:mapping.referenceStart,sequence:mapping.orientation===1?reference:rc(reference)},sequenceLength,ontologyTerms:[ontologyTerm],requestedOutputs:['RNA_SEQ','SPLICE_SITES','SPLICE_SITE_USAGE'],
    edit:{start,end,inserted:mapping.orientation===1?inserted:rc(inserted),blockers},
    annotation:{transcript:model.transcriptId||'',strand:(model.strand||1)*mapping.orientation,exons,codingExons,convention:'0-based half-open'}};
  if(comparisonContext)requestPayload.comparisonContext=comparisonContext;
  const request={...requestPayload,requestId:await reviewRequestId(requestPayload)};
  const sourceId=await reviewRequestId({design:requestPayload});
  const payload={schema:'assured-alphagenome-comparison-request/1',sourceId,candidates:[{id:'edited-allele',request}]};
  return {...payload,requestId:await reviewRequestId(payload)};
}

/** The prediction window the reviewer derives from this request. */
export function alleleContextInterval(request) {
  const length=request.sequenceLength;
  const start=request.comparisonContext?Number(request.comparisonContext.start):Math.max(0,Math.floor((request.edit.start+request.edit.end)/2)-length/2);
  return [start,start+length];
}

/** Insertions crop the far-right flank, so retained exon bases must stay observable. */
export function alleleReviewCoversAnnotation(batch) {
  const request=batch.candidates[0].request;
  const [start,end]=alleleContextInterval(request);
  const crop=Math.max(0,request.edit.inserted.length-(request.edit.end-request.edit.start));
  return request.annotation.exons.every(([a,b])=>start<=a&&b<=end-crop);
}

/** The smallest context that fits the annotated transcript. Long contexts cost more, so escalate only when needed. */
export async function buildCoveredAlleleReviewBatch(project,options={}) {
  const requested=options.sequenceLength||131072;
  const lengths=ALLELE_CONTEXT_LENGTHS.filter(n=>n>=requested);
  if(!lengths.length)return buildAlleleReviewBatch(project,options);
  let batch=null;
  for(const sequenceLength of lengths) {
    batch=await buildAlleleReviewBatch(project,{...options,sequenceLength});
    if(alleleReviewCoversAnnotation(batch))return batch;
  }
  // No context covers the transcript; the reviewer still reports its incomplete coverage explicitly.
  return batch;
}

export function validateAlleleReview(report,batch) {
  const request=batch.candidates[0].request;
  if(report?.schema!=='assured-alphagenome-allele-review/1'||report.status!=='complete'||report.evidenceType!=='model-prediction'||report.requestId!==batch.requestId||report.sourceId!==batch.sourceId||report.alleleRequestId!==request.requestId||JSON.stringify(report.ontologyTerms)!==JSON.stringify(request.ontologyTerms)||report.candidates?.[0]?.status!=='complete'||!report.modelVersion||!report.sdkVersion)throw new Error('The allele review is incomplete or does not match this design and cell context.');
  if(request.comparisonContext && JSON.stringify(report.comparisonContext)!==JSON.stringify(request.comparisonContext))throw new Error('The comparison window or retained-base mask does not match.');
  if(!Array.isArray(report.targetTracks)||!report.targetTracks.length||!request.requestedOutputs.every(output=>report.targetTracks.some(t=>t.output===output)))throw new Error('Expression or splicing predictions are missing.');
  for(const row of [...report.targetTracks,...(report.blockerTracks||[]),...(report.neighborTracks||[])]) {
    for(const key of ['referenceMean','editedMean','signedRelativeChange','maxAbsDelta'])if(row[key]!=null && (typeof row[key]!=='number'||!Number.isFinite(row[key])))throw new Error('Invalid allele prediction metrics.');
  }
  return report;
}

/** Synchronous binding for saved manuscript evidence; all allele-defining inputs. */
export function alleleReviewSource(project) {
  const r=project.designResult||{};
  return JSON.stringify({gene:project.gene,raw:project.genbankRaw,type:r.type,reference:r.gb?.genomicSequence,exons:r.gb?.exons,coding:r.gb?.cdsSegments,strand:r.gb?.strand,transcript:r.gb?.transcriptId,resultGene:r.gene,cuts:r.gs?.map(g=>g.cut),donor:r.donor,interval:r.donorReferenceInterval,insertBp:r.il,arm5:r.h5l,arm3:r.h3l,donors:r.os,blockers:r.ss});
}
