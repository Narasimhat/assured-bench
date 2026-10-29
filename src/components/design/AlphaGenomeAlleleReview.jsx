import { StructuralAlternativeComparison } from './StructuralAlternativeComparison.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { buildCoveredAlleleReviewBatch, validateAlleleReview, alleleReviewSource } from '../../services/alphaGenomeAlleles.js';
import { readDonorReviewResponse } from '../../services/alphaGenomeOnline.js';
import { REGULATORY_CONTEXT_CATALOG } from '../../services/regulatoryContexts.js';

const contexts=REGULATORY_CONTEXT_CATALOG.contexts.filter(c=>c.outputTracks.RNA_SEQ&&c.outputTracks.SPLICE_SITE_USAGE);
const number=n=>Number.isFinite(n)?n.toPrecision(4):'Not assessed';
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Tracks({rows,label}) {
  return <div style={{overflowX:'auto'}}><table aria-label={label}><thead><tr><th>Output / track</th><th>Reference signal</th><th>Edited signal</th><th>Signed RNA change</th><th>Maximum absolute change</th></tr></thead><tbody>{rows.map((t,i)=><tr key={i}><td>{t.gene?`${t.gene} · `:''}{t.output} · {t.name}{t.cellSpecific===false?' · tissue-agnostic':''}</td><td>{number(t.referenceMean)}</td><td>{number(t.editedMean)}</td><td>{t.output!=='RNA_SEQ'?'Not applicable':Number.isFinite(t.signedRelativeChange)?`${(t.signedRelativeChange*100).toFixed(2)}%`:'Not assessed'}</td><td>{number(t.maxAbsDelta)}</td></tr>)}</tbody></table></div>;
}

export function AlphaGenomeAlleleReview({project,onUpdateProject}) {
  const [alternativesBusy,setAlternativesBusy]=useState(false);
  const knockout=project.designResult.type==='ko';
  const [ontology,setOntology]=useState(project.alleleReviewContext||project.structuralAlternatives?.settings?.ontology||project.donorReviewContext||'');
  const [donorIndex,setDonorIndex]=useState(0),[batch,setBatch]=useState(null),[report,setReport]=useState(null);
  const [status,setStatus]=useState(null),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[unlocking,setUnlocking]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
  const controller=useRef(null),current=useRef(null);
  useEffect(()=>{const abort=new AbortController();fetch('/api/alphagenome/status',{signal:abort.signal,credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(setStatus).catch(()=>{});return()=>abort.abort();},[]);
  useEffect(()=>{
    let alive=true;controller.current?.abort();setBusy(false);setBatch(null);setReport(null);setError('');current.current=null;
    if(ontology)buildCoveredAlleleReviewBatch(project,{ontologyTerm:ontology,donorIndex}).then(value=>{
      if(!alive)return;setBatch(value);current.current=value.requestId;
      if(project.alleleReview?.requestId===value.requestId){try{setReport(validateAlleleReview(project.alleleReview,value))}catch(e){setError(e.message)}}
    }).catch(e=>{if(alive)setError(e.message)});
    return()=>{alive=false;controller.current?.abort();current.current=null;};
  },[project.id,project.designResult,project.genbankRaw,ontology,donorIndex]);
  const locked=status?.authenticationRequired===true&&status.authenticated!==true;
  async function unlock(e){e.preventDefault();setUnlocking(true);setError('');try{
    const response=await fetch('/api/alphagenome/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Access code was not accepted.');
    const next=await fetch('/api/alphagenome/status',{credentials:'same-origin',cache:'no-store'});if(!next.ok)throw new Error('Could not confirm the review session.');const state=await next.json();setStatus(state);if(!state.authenticated)throw new Error('The review session could not be confirmed.');setCode('');
  }catch(e){setError(e.message)}finally{setUnlocking(false)}}
  async function run(){const request=batch;controller.current=new AbortController();setBusy(true);setError('');setProgress('Reviewing the exact edited allele in the selected cells…');try{
    const response=await fetch('/api/alphagenome/compare',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.current.signal});
    const result=validateAlleleReview(await readDonorReviewResponse(response,{signal:controller.current.signal,onProgress:message=>{if(current.current===request.requestId)setProgress(message)}}),request);
    if(current.current!==request.requestId)return;
    setReport(result);onUpdateProject({alleleReview:result,alleleReviewContext:ontology,alleleReviewSource:alleleReviewSource(project)});
  }catch(e){if(current.current===request.requestId)setError(e.name==='AbortError'?'Stopped waiting. Online jobs continue; run the same review to retrieve the result.':e.message)}finally{if(current.current===request.requestId){setBusy(false);setProgress('')}}}
  async function importReport(e){const file=e.target.files?.[0];e.target.value='';if(!file||!batch)return;const request=batch;setError('');try{if(file.size>6000000)throw new Error('Review JSON must be smaller than 6 MB.');const result=validateAlleleReview(JSON.parse(await file.text()),request);if(current.current!==request.requestId)return;setReport(result);onUpdateProject({alleleReview:result,alleleReviewContext:ontology,alleleReviewSource:alleleReviewSource(project)});}catch(e){setError(e.message)}}
  const evidence=report?.structuralEvidence;
  return <section className="card" aria-label="AlphaGenome edited allele review">
    <h2>{knockout?'Knockout functional review':'Knock-in regulatory review'}</h2>
    <p>{knockout?'Review the defined deletion between the two cuts. Sequence disruption and predicted RNA/splicing changes are separate findings.':'Review the integrated cassette, both insertion boundaries and donor arm blockers in their genomic context.'}</p>
    <label>Experimental cell type <select aria-label="Cell type for edited allele review" value={ontology} disabled={busy||alternativesBusy} onChange={e=>setOntology(e.target.value)}><option value="">Choose cell type</option>{contexts.map(c=><option key={c.id} value={c.ontology}>{c.label}</option>)}</select></label>
    {!knockout&&project.designResult.type==='it'&&<label>Matched insertion donor <select value={donorIndex} disabled={busy||alternativesBusy} onChange={e=>setDonorIndex(Number(e.target.value))}>{(project.designResult.os||[]).map((d,i)=><option key={i} value={i}>{d.n||`Donor ${i+1}`}</option>)}</select></label>}
    {locked&&<form onSubmit={unlock}><label>Analysis access code <input type="password" autoComplete="current-password" value={code} disabled={unlocking} onChange={e=>setCode(e.target.value)}/></label><button type="submit" className="btn btn-secondary" disabled={!code||unlocking}>{unlocking?'Unlocking…':'Unlock online analysis'}</button><p>Your AlphaGenome API key stays on the server.</p></form>}
    <div className="candidate-actions"><button type="button" className="btn btn-primary" disabled={busy||alternativesBusy||!batch||!status?.available||locked} onClick={run}>{report?'Review edited allele again':'Review edited allele'}</button>{busy&&<button type="button" className="btn btn-secondary" onClick={()=>controller.current?.abort()}>Stop waiting</button>}</div>
    {status&&!status.available&&<p>Configure the local or online AlphaGenome reviewer to run predictions. Export and import remain available under Advanced.</p>}
    {progress&&busy&&<div role="status" aria-live="polite"><p>{progress}</p><p>Waiting for the RNA expression and splicing report. Results appear when the complete allele review finishes; zero completed designs does not mean the knockout failed.</p></div>}{error&&<p role="alert">{error}</p>}
    {report?<>
      <h3>{report.conclusion}</h3>
      <p>{report.annotationFullyCovered?'The annotated transcript fits the prediction window.':'Transcript coverage is incomplete; no complete functional conclusion is available.'} Protein loss is not confirmed. Alternative transcripts remain unassessed.</p>
      <p>Designed allele: {evidence.deletedBp} bp removed; {evidence.insertedBp} bp inserted; {evidence.codingBasesRemoved} annotated coding bases removed. {evidence.frameshiftSupported?'The defined deletion changes the coding frame.':evidence.entireAnnotatedCdsDeleted?'The defined deletion removes the entire annotated CDS.':'A coding frameshift has not been established.'}</p>
      <details><summary>Expression and splicing evidence</summary><p>RNA values compare matching retained exons; deleted bases are excluded. Signed RNA change shows expression direction and does not apply to splicing rows. For splicing, read Maximum absolute change: the largest local difference in predicted probability or usage, rather than the average across the gene. Splicing values measure disruption and are not knockout-success scores. Raw signal has assay-specific units. Splice-site predictions can be tissue-agnostic.</p><Tracks rows={report.targetTracks} label="Target expression and splicing"/></details>
      {!!report.blockerTracks?.length&&<details><summary>Additional donor blocker effects</summary><p>Intended insertion → final allele with arm blockers, compared in the same edited coordinate system.</p><Tracks rows={report.blockerTracks} label="Additional arm blocker effects"/></details>}
      <details><summary>Neighbouring genes</summary><p>{report.neighborStatus}. Retained gene-body RNA is a proxy; genes can extend beyond this window. Missing genes or tracks do not establish absence of effects.</p>{report.neighborTracks?.length?<Tracks rows={report.neighborTracks} label="Neighbouring gene RNA proxies"/>:<p>No neighbouring-gene measurements are available in this review.</p>}</details>
      {!!report.cassetteTracks?.length&&<details><summary>Inserted cassette signals</summary><p>Descriptive predictions within the inserted sequence; these do not establish reporter activity, translation or protein function.</p><ul>{report.cassetteTracks.map((t,i)=><li key={i}>{t.output} · {t.name}: mean {number(t.meanSignal)}, maximum {number(t.maxSignal)}</li>)}</ul></details>}
      <details><summary>Methods and limitations</summary><p>Model {report.modelVersion}; SDK {report.sdkVersion}; {contexts.find(c=>c.ontology===ontology)?.label||ontology}.</p><ul>{report.limitations.map((t,i)=><li key={i}>{t}</li>)}</ul><button type="button" className="btn btn-secondary" onClick={()=>download(report,'assured-edited-allele-review.json')}>Download review evidence</button></details>
      <p>Save the experiment to retain this review. Guide ranking, procurement gates and experimental QC remain separate.</p>
    </>:busy?null:error?<p>No new completed prediction report is available here. Your selected design is unchanged. Run the same review again to retrieve or retry it.</p>:<p>{project.structuralAppliedSource===alleleReviewSource(project)?"This selected allele was reviewed in the alternative comparison below. Run an individual review for a separate allele report.":"Predictions not run for this allele and cell context."} {knockout?"A larger effect score does not by itself mean a successful knockout.":"Regulatory predictions do not establish reporter or host-protein function."}</p>}
    {['ko','ct','nt'].includes(project.designResult.type)&&<StructuralAlternativeComparison project={project} ontology={ontology} status={status} locked={locked} busy={busy} onBusyChange={setAlternativesBusy} onUpdateProject={onUpdateProject}/>}
    <details><summary>Advanced · local export and import</summary><button type="button" className="btn btn-secondary" disabled={!batch||busy||alternativesBusy} onClick={()=>download(batch,'assured-edited-allele-request.json')}>Export allele request</button><label>Import allele review <input type="file" accept="application/json,.json" disabled={!batch||busy||alternativesBusy} onChange={importReport}/></label><p>Run the exported request with <code>tools/alphagenome/compare.py --output</code>. Requests contain genomic sequence; prediction runs send the reference and edited alleles to Google AlphaGenome.</p></details>
  </section>;
}
