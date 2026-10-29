import { readDonorReviewResponse } from "./alphaGenomeOnline.js";
import { assembleGenomicPairs, buildGenomicTwoPairResult } from "./genomicDonorCandidates.js";
import { assemblePointMutationPairs, runDesignFromTranscriptModel, summarizeProcurementReadiness } from "../engine/design/designEngine.js";
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from "../engine/design/designScheme.js";
import { generateDonorCandidates, rankDonorCandidates, buildCoveredDonorComparisonRequest, validateDonorComparison, donorSourceId } from "./donorCandidates.js";

export function orderedDonorCandidates(panel, report) {
  const ranking = rankDonorCandidates(panel, report);
  if (ranking.rows.some(r => !r.reviewed)) return [];
  const axes = ["annotatedUsageMaxDelta", "exonicRnaRelativeDelta", "spliceSiteMaxDelta"];
  const rows = ranking.rows.filter(r => r.eligible).sort((a,b) => {
    // Comparative frontier first; explicit priorities resolve remaining trade-offs.
    if (a.preferred !== b.preferred) return Number(b.preferred) - Number(a.preferred);
    for (const key of axes) { const delta = a.metrics[key] - b.metrics[key]; if (Math.abs(delta) > 1e-9) return delta; }
    return a.blockers - b.blockers || Math.abs(a.result.gs[0].d) - Math.abs(b.result.gs[0].d) || a.id.localeCompare(b.id);
  });
  return rows;
}

function orderedGuidePairs(rows) {
  const pairs=[];
  for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++)if(rows[a].result.gs[0].sp!==rows[b].result.gs[0].sp)pairs.push([rows[a],rows[b]]);
  // Match the native pair planner's preference for cuts at least 10 bp apart.
  // This is an engineering preference, not a deletion-safety threshold.
  return pairs.sort((a,b)=>Number(Math.abs(b[0].result.gs[0].cut-b[1].result.gs[0].cut)>=10)-Number(Math.abs(a[0].result.gs[0].cut-a[1].result.gs[0].cut)>=10));
}
export function suggestTwoDonorCandidates(panel, report) {
  return orderedGuidePairs(orderedDonorCandidates(panel,report))[0]?.map(c=>c.id)||[];
}

function forExperimentalValidation(result) {
  if(result.procurement.status === "ready")result.procurement={...result.procurement,status:"review",warnings:[...result.procurement.warnings,"Genome-wide guide and primer specificity remain unchecked; complete the external checks before ordering."]};
  return result;
}

export function buildTwoPairResult(project, panel, ids, protectBoth = false) {
  if (!Array.isArray(ids) || ids.length!==2 || new Set(ids).size!==2) throw new Error("Choose exactly two different matched designs.");
  const selected=ids.map(id=>panel.candidates.find(c=>c.id===id));
  if(selected.some(c=>!c?.eligible))throw new Error("Both designs must pass the core sequence and matched-guide protection checks.");
  if (project.designResult.type === "genomic-snv") return forExperimentalValidation(buildGenomicTwoPairResult(project,selected,protectBoth));
  const result=assemblePointMutationPairs(selected.map(c=>({result:c.result})));
  if(!protectBoth)return forExperimentalValidation(result);
  const rebuilt=runDesignFromTranscriptModel("pm",result.gb,project.mutation,"",null,{...project.options,enzyme:"spcas9",customGuides:result.gs.map(g=>g.sp),coDeliveryBlocking:true,ensureGuidePair:false,acceptWeakProtection:false,weakProtectionAcceptance:null});
  if(rebuilt.err)throw new Error(rebuilt.err);
  rebuilt.procurement=summarizeProcurementReadiness(rebuilt);
  if(rebuilt.gs.length!==2 || rebuilt.os.length!==2 || !rebuilt.coDeliverySafe || rebuilt.procurement.blockers.length)throw new Error("Both selected donors could not be protected against both guides while preserving the intended protein. Choose another combination or turn off joint protection.");
  const cuts=rebuilt.gs.map(g=>g.cut).sort((a,b)=>a-b);
  rebuilt.dualCutDeletionRisk={cutSites:cuts,spans:[cuts[1]-cuts[0]],note:`The two RNPs cut ${cuts[1]-cuts[0]} bp apart; screen for an intervening deletion as well as the intended substitution.`};
  return forExperimentalValidation(rebuilt);
}

export async function reviewCandidatePanel(project,panel,settings,{fetchFn=globalThis.fetch,signal,onProgress=()=>{}}={}) {
  const request=await buildCoveredDonorComparisonRequest(project,panel,{ontologyTerm:settings.ontology,sequenceLength:settings.sequenceLength||16384});
  const length=request.candidates[0].request.sequenceLength;
  onProgress(`Reviewing ${panel.candidates.length} designs in the selected cells…`);
  const response=await fetchFn('/api/alphagenome/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal});
  const data=await readDonorReviewResponse(response,{fetchFn,signal,onProgress});
  await validateDonorComparison(data,request);
  return {...panel,ontology:settings.ontology,sequenceLength:length,review:data};
}

export async function selectTwoReviewedDesigns(project,panel,ids,settings,callbacks={}) {
  if (panel.sourceId !== await donorSourceId(project) || panel.ontology !== settings.ontology) throw new Error("The comparison does not match the current source or cell context.");
  const rows=rankDonorCandidates(panel,panel.review).rows;
  if (ids.some(id=>!rows.find(c=>c.id===id)?.reviewed)) throw new Error("Both selected designs need complete AlphaGenome evidence before application.");
  const result=buildTwoPairResult(project,panel,ids,settings.protectBoth);
  let finalReview=null,finalCandidates=null;
  if(settings.protectBoth) {
    callbacks.onProgress?.("Checking the final donors against both RNPs and reviewing their rebuilt alleles…");
    finalCandidates=result.os.map((_,i)=>({id:`selected-${i+1}`,result:(result.type === "genomic-snv" ? assembleGenomicPairs : assemblePointMutationPairs)([{result,donorIndex:i}]),eligible:true,blockers:result.os[i].silentMutations?.length||0,protection:'strong',reasons:[]}));
    const finalPanel={...panel,candidates:finalCandidates};
    const reviewed=await reviewCandidatePanel(project,finalPanel,settings,callbacks);
    if(rankDonorCandidates(reviewed,reviewed.review).rows.some(c=>!c.reviewed))throw new Error("The rebuilt joint-protection donors do not have complete AlphaGenome evidence. The previous selection was retained.");
    finalReview=reviewed.review;
  }
  const next={...panel,selectedIds:ids,selectedId:null,protectBoth:settings.protectBoth,finalReview,finalCandidates,selectionReviewed:true};
  return {designResult:result,donorCandidatePanel:next,biomniReport:null,workflowRecommendation:null,status:result.procurement.status,
    svgScheme:buildDesignSchemeSvg(result),caption:buildDesignSchemeCaption(result),donorReviewContext:settings.ontology,donorProtectBoth:settings.protectBoth};
}

export async function designAndReviewDonors(project,settings,callbacks={}) {
  if(!settings.ontology)throw new Error("Choose the cell type for AlphaGenome review.");
  callbacks.onProgress?.("Preparing alternative guide–donor designs…");
  let panel=await generateDonorCandidates(project);
  panel=await reviewCandidatePanel(project,panel,settings,callbacks);
  if(rankDonorCandidates(panel,panel.review).rows.every(c=>c.reviewed)) {
    const refined=await generateDonorCandidates(project,panel);
    if(refined.candidates.length>panel.candidates.length)panel=await reviewCandidatePanel(project,refined,settings,callbacks);
  }
  let ids=suggestTwoDonorCandidates(panel,panel.review);
  if(ids.length!==2)return {donorCandidatePanel:panel,donorReviewContext:settings.ontology,donorProtectBoth:settings.protectBoth};
  if(settings.protectBoth) {
    const distinct=[];
    for(const c of orderedDonorCandidates(panel,panel.review))if(!distinct.some(x=>x.result.gs[0].sp===c.result.gs[0].sp)&&distinct.length<6)distinct.push(c);
    ids=[];const attempts=[];
    for(const candidates of orderedGuidePairs(distinct)) {
      if(ids.length)break;
      await new Promise(resolve=>setTimeout(resolve,0));
      const pair=candidates.map(c=>c.id);
      try{buildTwoPairResult(project,panel,pair,true);ids=pair;}
      catch(error){attempts.push({ids:pair,reason:error.message});}
    }
    panel={...panel,jointProtectionAttempts:attempts};
    if(!ids.length)throw new Error("No combination of the six candidate guides achieved strong protection against both RNPs. The previous selection was retained.");
  }
  return selectTwoReviewedDesigns(project,panel,ids,settings,callbacks);
}


/** Review existing matched donors for enzymes without an automatic alternative search.
 * Preserve their exact guide, donor, enzyme and blockers; never substitute SpCas9.
 */
export async function reviewSelectedDonors(project,settings,callbacks={}) {
  const base=project.designResult;
  if(!["pm","genomic-snv"].includes(base?.type)||!base.os?.length)throw new Error("Generate matched substitution donors before review.");
  if(!settings.ontology)throw new Error("Choose the cell type for AlphaGenome review.");
  const sourceId=await donorSourceId(project);
  const candidates=base.os.map((donor,i)=>{
    const result=(base.type==="genomic-snv"?assembleGenomicPairs:assemblePointMutationPairs)([{result:base,donorIndex:i}]);
    const protection=result.os[0].guideProtection?.[0]?.tier||"unknown";
    return {id:`selected-${i+1}`,baseline:true,result,eligible:!result.procurement.blockers.length&&protection==="strong",protection,blockers:result.ss?.length||0,reasons:[...result.procurement.blockers,...result.procurement.warnings]};
  });
  const panel=await reviewCandidatePanel(project,{schema:"assured-donor-candidates/1",sourceId,candidates,selectedOnly:true},settings,callbacks);
  return {donorCandidatePanel:panel,donorReviewContext:settings.ontology};
}
