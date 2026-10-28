import React, { useEffect, useRef, useState } from "react";
import { buildDonorComparisonRequest, validateDonorComparison, rankDonorCandidates, donorSourceId } from "../../services/donorCandidates.js";
import { designAndReviewDonors, suggestTwoDonorCandidates, selectTwoReviewedDesigns } from "../../services/donorWorkflow.js";
import { REGULATORY_CONTEXT_CATALOG } from "../../services/regulatoryContexts.js";

export const DONOR_REVIEW_CONTEXTS = REGULATORY_CONTEXT_CATALOG.contexts.filter(c=>c.outputTracks.RNA_SEQ && c.outputTracks.SPLICE_SITE_USAGE);
const number=value=>Number.isFinite(value)?value.toPrecision(3):"Not assessed";
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function DonorCandidateComparison({project,onUpdateProject,busy:designBusy,expanded=false}) {
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(project.donorWorkflowError||'');
  const [sourceId,setSourceId]=useState(''),[report,setReport]=useState(null),[available,setAvailable]=useState(false);
  const [ontology,setOntology]=useState(project.donorReviewContext||project.donorCandidatePanel?.ontology||'');
  const [protectBoth,setProtectBoth]=useState(project.donorProtectBoth??project.donorCandidatePanel?.protectBoth??project.options?.coDeliveryBlocking??false);
  const [picks,setPicks]=useState([]);
  const latest=useRef(project),generation=useRef(0),controller=useRef(null),summary=useRef(null);latest.current=project;
  const optionsKey=JSON.stringify(project.options||{});
  useEffect(()=>{if(project.donorWorkflowError)setError(project.donorWorkflowError)},[project.donorWorkflowError]);
  useEffect(()=>{let alive=true;generation.current++;controller.current?.abort();setBusy(false);setReport(null);setSourceId('');donorSourceId(project).then(id=>{if(alive)setSourceId(id)});return()=>{alive=false;generation.current++;controller.current?.abort()};},[project.id,project.genbankRaw,project.mutation,optionsKey]);
  useEffect(()=>{const abort=new AbortController();fetch('/api/alphagenome/status',{signal:abort.signal}).then(r=>r.ok?r.json():null).then(d=>setAvailable(d?.available===true)).catch(()=>{});return()=>abort.abort();},[]);
  const panel=project.donorCandidatePanel?.sourceId===sourceId?project.donorCandidatePanel:null;
  useEffect(()=>{let alive=true;setReport(null);
    if(panel?.review && panel.ontology===ontology)buildDonorComparisonRequest(project,panel,{ontologyTerm:ontology,sequenceLength:panel.sequenceLength}).then(batch=>validateDonorComparison(panel.review,batch)).then(async data=>{
      if(panel.protectBoth && panel.finalReview){const batch=await buildDonorComparisonRequest(project,{...panel,candidates:panel.finalCandidates},{ontologyTerm:ontology,sequenceLength:panel.sequenceLength});await validateDonorComparison(panel.finalReview,batch);}
      if(alive){setReport(data);setPicks(panel.selectedIds?.length===2?panel.selectedIds:suggestTwoDonorCandidates(panel,data));}
    }).catch(e=>{if(alive)setError(e.message)});
    return()=>{alive=false};
  },[panel,ontology,project.genbankRaw,project.mutation]);
  const ranking=panel?rankDonorCandidates(panel,report):null;
  const currentSelection=Boolean(report && panel.selectedIds?.length===2 && panel.selectionReviewed && panel.protectBoth===protectBoth && (!protectBoth||panel.finalReview));
  const locked=busy||designBusy||!sourceId;
  const contextName=DONOR_REVIEW_CONTEXTS.find(c=>c.ontology===ontology)?.label||ontology;
  const selected=currentSelection?panel.selectedIds.map(id=>panel.candidates.find(c=>c.id===id)).filter(Boolean):[];
  const expectedDonors=panel?.protectBoth?panel.finalCandidates:selected;
  const selectedMatches=selected.length===2 && project.designResult.gs?.length===2 && selected.every((c,i)=>project.designResult.gs[i]?.sp===c.result.gs[0].sp && project.designResult.os?.[i]?.od===expectedDonors?.[i]?.result.os[0].od);
  const progressUpdate=text=>{setProgress(text)};
  async function operate(action){const token=++generation.current,originalId=await donorSourceId(project);controller.current=new AbortController();setBusy(true);setError('');
    try{const fields=await action({signal:controller.current.signal,onProgress:progressUpdate});if(token!==generation.current||await donorSourceId(latest.current)!==originalId)return;
      onUpdateProject({...fields,donorWorkflowError:null});summary.current?.scrollIntoView({behavior:'smooth',block:'start'});summary.current?.focus();
    }catch(e){if(token===generation.current)setError(e.name==='AbortError'?'Review cancelled; the previous selection was retained.':e.message)}
    finally{if(token===generation.current){setBusy(false);setProgress('')}}
  }
  const settings={ontology,protectBoth,sequenceLength:panel?.sequenceLength||16384};
  const run=()=>operate(callbacks=>designAndReviewDonors(project,settings,callbacks));
  const apply=()=>operate(callbacks=>selectTwoReviewedDesigns(project,{...panel,review:report},picks,settings,callbacks));
  function toggle(id){setPicks(old=>old.includes(id)?old.filter(x=>x!==id):old.length<2?[...old,id]:old);}
  function cancel(){generation.current++;controller.current?.abort();setBusy(false);setProgress('');setError('Review cancelled; the previous selection was retained.');}
  async function exportRequest(){try{download(await buildDonorComparisonRequest(project,panel,{ontologyTerm:ontology,sequenceLength:panel.sequenceLength||16384}),'assured-donor-comparison-request.json')}catch(e){setError(e.message)}}
  async function importReview(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;
    await operate(async()=>{if(file.size>6000000)throw new Error('Comparison JSON must be smaller than 6 MB.');const batch=await buildDonorComparisonRequest(project,panel,{ontologyTerm:ontology,sequenceLength:panel.sequenceLength||16384});const data=await validateDonorComparison(JSON.parse(await file.text()),batch);return {donorCandidatePanel:{...panel,review:data,ontology,selectionReviewed:false},donorReviewContext:ontology};});
  }
  const crossWarning=selectedMatches&&!project.designResult.coDeliverySafe;
  return <section className="card donor-candidate-comparison" aria-label="Two-design recommendation">
    <h2>{selectedMatches?'Two designs selected for validation':'Design and review two guide–donor pairs'}</h2>
    <p>{selectedMatches?`${contextName} · ${panel.candidates.length} candidates reviewed. Each guide is linked to its matched donor.`:'Choose your cell type. The tool compares and refines alternatives, then selects two different guides with their matched donors.'}</p>
    {!selectedMatches && <fieldset disabled={locked}><legend>Experimental cells</legend><label>Cell type <select value={ontology} onChange={e=>{setOntology(e.target.value);setError('');onUpdateProject({donorReviewContext:e.target.value});}}><option value="">Choose cell type</option>{DONOR_REVIEW_CONTEXTS.map(c=><option key={c.id} value={c.ontology}>{c.label}</option>)}</select></label></fieldset>}
    <details><summary>Advanced</summary>{selectedMatches && <label>Cell type <select value={ontology} disabled={locked} onChange={e=>{setOntology(e.target.value);setError('');onUpdateProject({donorReviewContext:e.target.value});}}>{DONOR_REVIEW_CONTEXTS.map(c=><option key={c.id} value={c.ontology}>{c.label}</option>)}</select></label>}<label><input type="checkbox" checked={protectBoth} disabled={locked} onChange={e=>{setProtectBoth(e.target.checked);setError('')}}/>Protect each donor against both guides</label><p>When enabled, final donors are rebuilt and reviewed again with AlphaGenome. A complete result requires strong predicted protection against both RNPs.</p></details>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="candidate-actions"><button className={selectedMatches ? "btn btn-secondary" : "btn btn-primary"} disabled={locked||!ontology||!available} onClick={run}>{selectedMatches?'Review designs again':'Design and review'}</button>{busy&&<button className="btn btn-secondary" onClick={cancel}>Cancel</button>}</div>
    {!available&&<p>The automatic review runs in the local app with its private key configured. The hosted app requires the local comparison runner.</p>}
    {busy&&<p role="status" aria-live="polite">{progress||'Preparing the review…'}</p>}
    <div ref={summary} tabIndex={-1} aria-live="polite">
      {selectedMatches&&<><div className="two-design-cards">{selected.map((c,i)=><article key={c.id}><h3>Design {i+1}</h3><p>{c.id} · {panel.protectBoth?'Final donor reviewed with joint protection':'Matched donor reviewed'}</p><code>{project.designResult.gs[i].sp}</code><p>{project.designResult.os[i].od.length} nt donor · {panel.protectBoth?'both guides protected':'matched guide protected'}</p></article>)}</div>
        <p>{panel.protectBoth?'Both final donors were reviewed after rebuilding for protection against both RNPs.':'The two designs were reviewed as separate edited alleles.'} Specificity and experimental validation remain open.</p>
        {crossWarning&&<p className="candidate-warning">Cross-guide protection is incomplete. An active second RNP may re-cut a repaired allele. Joint protection is available under Advanced.</p>}
        {project.designResult.dualCutDeletionRisk&&<p className="muted">{project.designResult.dualCutDeletionRisk.note}</p>}
      </>}
      {report&&!selectedMatches&&!busy&&<p>Review completed. {ranking.rows.filter(r=>r.reviewed).length}/{panel.candidates.length} candidates have complete comparable evidence. Choose two eligible alternatives below, or run Design and review to select automatically.</p>}
      <p className="muted">Recommendations compare predicted additional effects of donor blockers. They do not establish safety, HDR yield or disease phenotype.</p>
    </div>
    {panel&&<details open={expanded||undefined}><summary>Compare alternatives</summary>
      <p>Original designs are retained as baselines. Select two different guides; the report and order handoff use only the applied selection.</p>
      <div className="candidate-table"><table><caption>Guide–donor alternatives</caption><thead><tr><th>Select</th><th>Design</th><th>Guide (5′–3′)</th><th>Matched protection</th><th>RNA disturbance</th><th>Splice usage Δ</th><th>Splice-site Δ</th></tr></thead><tbody>{ranking.rows.map(c=>{const duplicate=picks.some(id=>id!==c.id&&panel.candidates.find(x=>x.id===id)?.result.gs[0].sp===c.result.gs[0].sp);return <tr key={c.id}><td><input type="checkbox" aria-label={`Select ${c.id}`} checked={picks.includes(c.id)} disabled={locked||!c.eligible||(!picks.includes(c.id)&&(picks.length>=2||duplicate))} onChange={()=>toggle(c.id)}/></td><td>{c.id}{c.baseline?' · original':''}</td><td><code>{c.result.gs[0].sp}</code></td><td>{c.protection}</td><td>{number(c.metrics?.exonicRnaRelativeDelta)}</td><td>{number(c.metrics?.annotatedUsageMaxDelta)}</td><td>{number(c.metrics?.spliceSiteMaxDelta)}</td></tr>})}</tbody></table></div>
      <button className="btn btn-secondary" disabled={locked||picks.length!==2||!report||(protectBoth&&!available)} onClick={apply}>Use these two designs</button>
      <details><summary>Prediction details and files</summary><p>{ranking.preferencePolicy} Splice-site predictions are tissue-agnostic. Model contexts may not match your differentiation or maturation state.</p>
        {report&&<p>Model {report.modelVersion} · SDK {report.sdkVersion} · {report.ontologyTerms.join(', ')} · {report.createdAt}. Window: {panel.sequenceLength.toLocaleString()} bp.</p>}
        {ranking.rows.map(c=><details key={c.id}><summary>{c.id} · {c.review?.status||'not reviewed'}</summary><p>{c.reasons.join(' ')||'Sequence checks pass; external specificity remains unchecked.'} {c.review?.error}</p><code className="candidate-donor-sequence">{c.result.os[0].od}</code>{c.review?.localizedTracks?.map((t,i)=><div key={i}><h4>{t.output} · {t.name}</h4><table><thead><tr><th>Genomic position (1-based)</th><th>Intended allele</th><th>Full donor</th><th>Signed Δ</th></tr></thead><tbody>{t.topChanges.map(x=><tr key={x.position}><td>{x.position}</td><td>{number(x.before)}</td><td>{number(x.after)}</td><td>{number(x.delta)}</td></tr>)}</tbody></table></div>)}</details>)}
        <button className="btn btn-secondary" disabled={locked||!ontology} onClick={exportRequest}>Export comparison request</button><label>Import completed comparison <input type="file" accept=".json" disabled={locked||!ontology} onChange={importReview}/></label>
        {report&&<button className="btn btn-secondary" onClick={()=>download(report,'assured-donor-comparison.json')}>Download comparison</button>}
        {panel.finalReview&&<button className="btn btn-secondary" onClick={()=>download(panel.finalReview,'assured-final-two-donor-review.json')}>Download final donor review</button>}
      </details>
    </details>}
    <p className="muted">Save your experiment to retain the selected designs and review evidence on this device.</p>
  </section>;
}
