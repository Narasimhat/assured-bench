import { runDesignFromTranscriptModel, previewKoPair, summarizeProcurementReadiness } from '../engine/design/designEngine.js';
import { buildAlleleReviewBatch, validateAlleleReview, alleleReviewSource } from './alphaGenomeAlleles.js';
import { reviewRequestId } from './alphaGenomeReview.js';
import { readDonorReviewResponse } from './alphaGenomeOnline.js';
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from '../engine/design/designScheme.js';
import { withoutRunOverrides } from './runOptions.js';

export const TWO_A_REPORTERS=['T2A-EGFP','T2A-mScarlet_I3','T2A-mStayGold2','P2A-mCherry','P2A-mScarlet','P2A-mStayGold2'];
const REQUIREMENTS=['unknown','neither','preserve-n','preserve-c','preserve-both'];
const cleanOptions=p=>{const options=withoutRunOverrides(p.options);delete options.koLindel;delete options.koOutcomesUnavailable;return {...options,enzyme:p.options?.enzyme||p.designResult?.enzyme?.id||'spcas9',expectedGene:p.gene,acceptWeakProtection:false,weakProtectionAcceptance:null};};
export function structuralComparisonSnapshot(project,settings) {
 const r=project.designResult;
 return JSON.stringify({reference:project.genbankRaw,genome:r?.gb?.genomicSequence,exons:r?.gb?.exons,coding:r?.gb?.cdsSegments,transcript:r?.gb?.transcriptId,gene:project.gene,mode:r?.type==='ko'?'ko':'2a',options:cleanOptions(project),armLength:r?.hl||400,reporter:r?.type==='ko'?null:settings.reporter,terminalRequirement:r?.type==='ko'?null:settings.terminalRequirement,ontology:settings.ontology});
}

function materialize(project,recipe,nativeOptions={}) {
 const options={...cleanOptions(project),...nativeOptions,...(recipe.guides?.length?{customGuides:recipe.guides}:{})};
 const result=runDesignFromTranscriptModel(recipe.type,project.designResult.gb,'',recipe.tag||'',project.designResult.hl||400,options);
 if(result.err)throw new Error(result.err);
 result.procurement=summarizeProcurementReadiness(result);
 return result;
}
function assess(result,settings) {
 const reasons=[...(result.procurement?.blockers||[])];
 let nativeTier=null,nativeLof=null;
 if(result.type==='ko') {
  nativeTier=result.koAssessment?.tier||null;
  nativeLof=Number.isFinite(result.koPairChoice?.minLofPct)?result.koPairChoice.minLofPct:null;
  if(!result.deletionOutcome?.frameshiftPredicted)reasons.push('The native deletion assessment does not predict a frameshift.');
  if(nativeTier!=='robust')reasons.push('Native transcript disruption is not in the robust tier.');
 } else {
  if(!result.insertValidation?.matchesPreset||!result.insertValidation?.framePreserved||result.insertValidation?.unexpectedStop)reasons.push('The native cassette/frame checks did not pass.');
  if(!result.guideProtection?.length||result.guideProtection.some(p=>p.tier!=='strong'))reasons.push('Strong protection is required against every guide in this design.');
  if(settings.terminalRequirement==='preserve-both'||result.type==='nt'&&settings.terminalRequirement==='preserve-n'||result.type==='ct'&&settings.terminalRequirement==='preserve-c')reasons.push('This arrangement changes a host-protein terminus required to remain native.');
 }
 return {eligible:!reasons.length,reasons,nativeTier,nativeLof,blockerCount:result.ss?.length||0};
}

/** Bounded native designs. Saved recipes are regenerated and must reproduce request IDs. */
export async function prepareStructuralAlternatives(project,settings,saved=null) {
 const knockout=project.designResult?.type==='ko';
 if(!knockout&&!['ct','nt'].includes(project.designResult?.type))throw new Error('Use a dual-guide knockout or terminal knock-in design.');
 if(!settings.ontology)throw new Error('Choose a cell type before comparing designs.');
 if(!knockout&&!TWO_A_REPORTERS.includes(settings.reporter))throw new Error('Choose a supported separate 2A reporter.');
 if(!REQUIREMENTS.includes(settings.terminalRequirement||'unknown'))throw new Error('Unknown terminal requirement.');
 const snapshot=structuralComparisonSnapshot(project,settings),sourceId=await reviewRequestId({snapshot});
 if(saved&&saved.sourceId!==sourceId)throw new Error('The saved alternatives belong to different design inputs, reporter or cell context.');
 const candidates=[],attempts=[],seen=new Set();
 let nativeOptions={};
 if(knockout&&cleanOptions(project).enzyme==='spcas9'){try{nativeOptions.koLindel=await (await import('../engine/design/lindel/loadLindel.js')).loadLindel()}catch{nativeOptions.koOutcomesUnavailable='Lindel could not be loaded for this comparison; no repair probabilities inferred.'}}
 const add=recipe=>{
  try{const result=materialize(project,recipe,nativeOptions);const key=JSON.stringify([result.type,result.gs.map(g=>g.sp).sort(),result.donor||null]);if(seen.has(key))return;seen.add(key);
   const id=`design-${candidates.length+1}`;const candidate={id,recipe,result,...assess(result,settings)};candidates.push(candidate);return candidate;
  }catch(e){attempts.push({recipe,reason:e.message});}
 };
 if(saved) {
  for(const c of saved.candidates){const next=add(c.recipe);if(!next||next.id!==c.id)throw new Error('A saved native design cannot be reproduced. Generate a fresh comparison.');}
 } else if(knockout) {
  add({type:'ko',guides:project.designResult.gs.map(g=>g.sp)});
  const rows=(project.designResult.koPicker?.rows||[]).slice(0,12);
  const pairs=[];
  for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){
   const preview=previewKoPair(project.genbankRaw,[rows[a],rows[b]],{expectedGene:project.gene});
   if(preview.ok&&preview.spacing>=10&&preview.spacing<=140&&preview.frameshiftPredicted&&preview.tier==='robust')pairs.push({guides:[rows[a].spacer,rows[b].spacer],rank:rows[a].rank+rows[b].rank});
  }
  pairs.sort((a,b)=>a.rank-b.rank);
  for(const pair of pairs){if(candidates.length>=6)break;add({type:'ko',guides:pair.guides});await new Promise(resolve=>setTimeout(resolve,0));}
 } else {
  // Retain both terminal baselines before adding guide alternatives, so one end
  // cannot consume the budget and hide the other end.
  const baselines=['nt','ct'].map(type=>add({type,tag:settings.reporter})).filter(Boolean);
  for(let round=0;round<2;round++)for(const base of baselines){
   if(candidates.length>=6)break;
   const guide=base.result.guideAlternatives?.candidates?.filter(g=>!base.result.gs.some(s=>s.sp===g.sp))[round];
   if(guide)add({type:base.result.type,tag:settings.reporter,guides:[guide.sp]});
   await new Promise(resolve=>setTimeout(resolve,0));
  }
 }
 if(!candidates.length)throw new Error('No native alternative designs could be generated.');
 for(const candidate of candidates){candidate.batch=await buildAlleleReviewBatch({...project,designResult:candidate.result},{ontologyTerm:settings.ontology});}
 const requests=candidates.map(c=>c.batch.candidates[0].request),exons=requests[0].annotation.exons,length=requests[0].sequenceLength;
 if(requests.some(r=>JSON.stringify(r.annotation)!==JSON.stringify(requests[0].annotation)||JSON.stringify(r.reference)!==JSON.stringify(requests[0].reference)))throw new Error('Alternative designs must share reference and transcript annotation.');
 const left=Math.min(...exons.map(e=>e[0]),...requests.map(r=>r.edit.start));
 const right=Math.max(...exons.map(e=>e[1]),...requests.map(r=>r.edit.end));
 const start=Math.max(0,Math.floor((left+right)/2)-length/2),end=start+length;
 const crop=Math.max(0,...requests.map(r=>r.edit.inserted.length-(r.edit.end-r.edit.start)));
 if(left<=start||right>=end-crop)throw new Error('The full transcript and all alternative alleles do not fit the common 131 kb context. No fair preference can be calculated.');
 const exclusions=requests.filter(r=>r.edit.end>r.edit.start).map(r=>[r.edit.start,r.edit.end]);
 if(crop)exclusions.push([end-crop,end]);
 exclusions.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const merged=[];for(const span of exclusions){const prev=merged.at(-1);if(prev&&span[0]<=prev[1])prev[1]=Math.max(prev[1],span[1]);else merged.push([...span]);}
 const comparisonContext={schema:'assured-structural-comparison-context/1',start,exclusions:merged};
 for(const c of candidates){c.batch=await buildAlleleReviewBatch({...project,designResult:c.result},{ontologyTerm:settings.ontology,comparisonContext});
  const old=saved?.candidates.find(s=>s.id===c.id);if(old){if(old.requestId!==c.batch.requestId)throw new Error('A saved allele/window cannot be reproduced. Run a new comparison.');if(old.review)c.review=validateAlleleReview(old.review,c.batch);}
 }
 return {schema:'assured-structural-alternatives/1',sourceId,sourceSnapshot:snapshot,settings:{...settings},mode:knockout?'ko':'2a',comparisonContext,candidates,attempts};
}

function maximum(rows,output,key,absolute=false){const values=rows.filter(t=>t.output===output).map(t=>t[key]);return values.length&&values.every(Number.isFinite)?Math.max(...values.map(v=>absolute?Math.abs(v):v)):null;}
export function structuralMetrics(report) {
 if(!report?.annotationFullyCovered)return null;
 const rna=maximum(report.targetTracks,'RNA_SEQ','signedRelativeChange',true);
 const retained=maximum(report.targetTracks,'RNA_SEQ','signedRelativeChange');
 const usage=maximum(report.targetTracks,'SPLICE_SITE_USAGE','maxAbsDelta');
 const sites=maximum(report.targetTracks,'SPLICE_SITES','maxAbsDelta');
 const neighbors=report.neighborTracks||[];
 // Compare measured local gene-body RNA proxies on the common retained mask.
 // Partial genes remain explicitly partial; this is not a genome-wide assessment.
 const neighbor=report.neighborStatus==='available'&&neighbors.length&&neighbors.every(t=>Number.isFinite(t.maxAbsDelta))?Math.max(...neighbors.map(t=>t.maxAbsDelta)):null;
 return {rnaDisturbance:rna,remainingRna:retained==null?null:1+retained,usage,sites,neighbor};
}

export function rankStructuralAlternatives(plan) {
 const rows=plan.candidates.map(c=>({...c,metrics:c.review?structuralMetrics(c.review):null}));
 const required=plan.mode==='ko'?['remainingRna']:['rnaDisturbance','usage','sites'];
 const signature=c=>JSON.stringify(c.review?.targetTracks.map(t=>[t.output,t.name,t.strand,t.ontology,t.comparedBases]));
 const reviewed=rows.filter(c=>c.eligible&&c.review);
 const matched=reviewed.every(c=>signature(c)===signature(reviewed[0]));
 const complete=matched&&rows.every(c=>!c.eligible || c.review?.status==='complete'&&required.every(k=>Number.isFinite(c.metrics?.[k])));
 const eligible=rows.filter(c=>c.eligible&&c.review&&required.every(k=>Number.isFinite(c.metrics?.[k])));
 const axes=[...required];
 const neighborAvailable=eligible.length>0&&eligible.every(c=>Number.isFinite(c.metrics.neighbor));
 if(neighborAvailable)axes.push('neighbor');
 const nativeLofAvailable=plan.mode==='ko'&&eligible.length>0&&eligible.every(c=>Number.isFinite(c.nativeLof));
 const vector=c=>[...axes.map(k=>c.metrics[k]),...(nativeLofAvailable?[-c.nativeLof]:[])];
 const dominates=(a,b)=>{const x=vector(a),y=vector(b);return x.every((v,i)=>v<=y[i]+1e-9)&&x.some((v,i)=>v<y[i]-1e-9)};
 const frontier=complete?eligible.filter(b=>!eligible.some(a=>a.id!==b.id&&dominates(a,b))):[];
 // Gene-body proxy effects do not become a silent zero. A provisional frontier
 // is shown, but a recommendation also needs measured local neighbour proxies.
 let status='Trade-offs / insufficient evidence',recommendedId=null;
 const terminalKnown=plan.mode==='ko'||plan.settings.terminalRequirement!=='unknown';
 if(complete&&frontier.length===1&&neighborAvailable&&terminalKnown){recommendedId=frontier[0].id;status=plan.mode==='ko'?'Preferred knockout for validation':frontier[0].result.type==='nt'?'Prefer N-terminal':'Prefer C-terminal';}
 const reasons=[];
 if(!matched)reasons.push('Prediction tracks or retained-base coverage do not match across alternatives.');
 if(!complete)reasons.push('At least one eligible design lacks complete matched expression/splicing evidence.');
 if(!eligible.length)reasons.push('No alternative passes all native feasibility and review requirements.');
 if(!neighborAvailable)reasons.push('Neighbouring-gene measurements are unavailable; missing evidence is not treated as zero effect.');
 if(plan.mode==='ko'&&!nativeLofAvailable)reasons.push('Native repair-outcome probabilities are unavailable for this candidate set; structural disruption remains separate.');
 if(!terminalKnown)reasons.push('Host-terminal domain/localization requirements are unknown. Confirm them before an overall N/C preference.');
 if(frontier.length>1)reasons.push('Multiple designs make different trade-offs; no design improves every assessed axis.');
 if(recommendedId)reasons.push(plan.mode==='ko'?'This design improves the assessed comparative axes without weakening the native disruption requirements. RNA reduction does not establish protein loss.':'This design preserves the assessed regulatory axes best within the stated terminal requirements; reporter function and 2A skipping remain unverified.');
 return {rows,frontier:frontier.map(c=>c.id),recommendedId,status,reasons,axes,nativeLofAvailable,neighborAvailable};
}

export async function reviewStructuralAlternatives(plan,{fetchFn=fetch,signal,onProgress=()=>{},onCandidate=()=>{}}={}) {
 for(let i=0;i<plan.candidates.length;i++){
  const c=plan.candidates[i];if(!c.eligible||c.review)continue;
  onProgress(`Reviewing ${c.id} (${i+1}/${plan.candidates.length}) in the common cell context…`);
  try{const response=await fetchFn('/api/alphagenome/compare',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(c.batch),signal});c.review=validateAlleleReview(await readDonorReviewResponse(response,{fetchFn,signal,onProgress}),c.batch);delete c.error;}
  catch(e){if(e.name==='AbortError')throw e;c.error=e.message;}
  onCandidate(plan);
 }
 return plan;
}

/** Persist recipes and evidence without duplicating full genomic references/results. */
export function saveStructuralAlternatives(plan) {
 return {...plan,candidates:plan.candidates.map(({result,batch,...c})=>({...c,guideSpacers:result.gs.map(g=>g.sp),type:result.type,insertBp:result.il||0,deletionBp:result.deletionOutcome?.deletionSize||0,requestId:batch.requestId})),createdAt:new Date().toISOString()};
}
export function applyStructuralAlternative(project,plan,id) {
 if(plan.sourceSnapshot!==structuralComparisonSnapshot(project,plan.settings))throw new Error('Design inputs changed; regenerate alternatives.');
 const candidate=plan.candidates.find(c=>c.id===id);
 if(!candidate?.eligible||!candidate.review)throw new Error('Choose a feasible alternative with a completed review.');
 validateAlleleReview(candidate.review,candidate.batch);
 const result=candidate.result;
 result.procurement=summarizeProcurementReadiness(result);
 if(result.procurement.blockers.length)throw new Error('The selected design no longer passes native checks.');
 if(result.procurement.status==='ready')result.procurement={...result.procurement,status:'review',warnings:[...result.procurement.warnings,'Genome-wide specificity and experimental validation remain open.']};
 return {structuralAppliedSource:alleleReviewSource({...project,designResult:result}),svgScheme:buildDesignSchemeSvg(result),caption:buildDesignSchemeCaption(result),designResult:result,editType:result.type,tag:result.tag||project.tag,structuralAlternatives:{...saveStructuralAlternatives(plan),appliedId:id},alleleReview:null,alleleReviewSource:null,biomniReport:null,workflowRecommendation:null,status:result.procurement.status};
}
