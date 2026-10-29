import React, {useEffect,useRef,useState} from 'react';
import { TWO_A_REPORTERS,prepareStructuralAlternatives,structuralComparisonSnapshot,rankStructuralAlternatives,reviewStructuralAlternatives,saveStructuralAlternatives,applyStructuralAlternative } from '../../services/structuralAlternatives.js';
const number=n=>Number.isFinite(n)?n.toPrecision(3):'Not assessed';

export function StructuralAlternativeComparison({project,ontology,status,locked,busy:parentBusy,onBusyChange,onUpdateProject}) {
 const knockout=project.designResult.type==='ko';
 const saved=project.structuralAlternatives;
 const [reporter,setReporter]=useState(saved?.settings.reporter||(TWO_A_REPORTERS.includes(project.designResult.tag)?project.designResult.tag:'T2A-EGFP'));
 const [requirement,setRequirement]=useState(saved?.settings.terminalRequirement||'unknown');
 const [plan,setPlan]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
 const reviewCache=useRef(new Map());
 const controller=useRef(null),generation=useRef(0),latest=useRef(null),currentPlan=useRef(null);
 const settings={ontology,reporter,terminalRequirement:requirement};
 const snapshot=structuralComparisonSnapshot(project,settings);latest.current=snapshot;
 useEffect(()=>{let alive=true;generation.current++;controller.current?.abort();setBusy(false);onBusyChange(false);setPlan(null);currentPlan.current=null;setError('');
  if(saved&&ontology&&saved.sourceSnapshot===snapshot)prepareStructuralAlternatives(project,settings,saved).then(p=>{if(alive){setPlan(p);currentPlan.current=p;for(const c of p.candidates)if(c.review)reviewCache.current.set(c.batch.requestId,c.review)}}).catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false;generation.current++;controller.current?.abort();onBusyChange(false)};
 },[snapshot,project.id]);
 async function run(){const token=++generation.current,source=snapshot;controller.current=new AbortController();setBusy(true);onBusyChange(true);setError('');setProgress('Building native alternative designs…');let next=null;
  try{
   next=currentPlan.current?.sourceSnapshot===source?currentPlan.current:await prepareStructuralAlternatives(project,settings);
   if(token!==generation.current||latest.current!==source)return;
   for(const c of next.candidates)if(!c.review&&reviewCache.current.has(c.batch.requestId))c.review=reviewCache.current.get(c.batch.requestId);
   const update=p=>{if(token!==generation.current||latest.current!==source)return;for(const c of p.candidates)if(c.review)reviewCache.current.set(c.batch.requestId,c.review);currentPlan.current=p;setPlan({...p,candidates:[...p.candidates]});onUpdateProject({structuralAlternatives:saveStructuralAlternatives(p),alleleReviewContext:ontology});};
   update(next);
   await reviewStructuralAlternatives(next,{signal:controller.current.signal,onProgress:t=>{if(token===generation.current)setProgress(t)},onCandidate:update});update(next);
  }catch(e){if(token===generation.current)setError(e.name==='AbortError'?'Stopped waiting. Completed comparisons are retained; run again to resume.':e.message)}finally{if(token===generation.current){setBusy(false);onBusyChange(false);setProgress('')}}
 }
 function apply(id){try{const fields=applyStructuralAlternative(project,plan,id);onUpdateProject(fields)}catch(e){setError(e.message)}}
 const ranking=plan?rankStructuralAlternatives(plan):null;
 return <section aria-label="Compare structural edit alternatives" style={{marginTop:'1rem',borderTop:'1px solid var(--border)',paddingTop:'1rem'}}>
  <h3>{knockout?'Compare knockout alternatives':'Compare separate 2A reporter designs'}</h3>
  <p>{knockout?'Compare up to six native guide pairs. Native disruption evidence and predicted target RNA are assessed separately from neighbouring-gene effects.':'Compare N-terminal and C-terminal arrangements, plus alternative guides and matched donors. Both arrangements use the same reporter and 2A peptide.'}</p>
  {!knockout&&<><label>Separate reporter <select aria-label="Separate 2A reporter" value={reporter} disabled={busy||parentBusy} onChange={e=>setReporter(e.target.value)}>{TWO_A_REPORTERS.map(name=><option key={name}>{name}</option>)}</select></label>
   <details><summary>Host-protein terminal requirements</summary><label>Known terminal requirement <select aria-label="Host-protein terminal requirement" disabled={busy||parentBusy} value={requirement} onChange={e=>setRequirement(e.target.value)}><option value="unknown">Unknown — keep N/C preference provisional</option><option value="neither">No known requirement for a native terminus</option><option value="preserve-n">Native N-terminus must remain intact</option><option value="preserve-c">Native C-terminus must remain intact</option><option value="preserve-both">Both native termini must remain intact</option></select></label><p>C-terminal: host–2A–reporter; the host retains most of 2A at its C-terminus. N-terminal: reporter–2A–host; the native start codon is replaced and the host begins with the 2A-derived proline. Terminal domains, localization signals and 2A skipping efficiency are not predicted by AlphaGenome.</p></details></>}
  <button type="button" className="btn btn-secondary" disabled={busy||parentBusy||!ontology||!status?.available||locked} onClick={run}>{busy?'Comparing alternatives…':plan?'Review / resume alternatives':'Compare and recommend alternatives'}</button>
  {busy&&<button type="button" className="btn btn-secondary" onClick={()=>controller.current?.abort()}>Stop comparison</button>}
  {progress&&busy&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}
  {ranking&&<>
   <h4>{ranking.status}</h4><ul>{ranking.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>
   <p>Compared in one genomic window and cell context, using matching retained bases. Recommendations are starting designs for experimental validation, not success or safety probabilities. Neighbouring-gene values describe local RNA proxies and can cover only part of a gene.</p>
   <div style={{overflowX:'auto'}}><table aria-label="Structural design alternatives"><thead><tr><th>Design</th><th>Native checks</th><th>{knockout?'Remaining target RNA ratio':'Host RNA disturbance'}</th>{!knockout&&<><th>Splice usage Δ</th><th>Splice-site Δ</th></>}<th>Neighbour RNA max Δ</th><th>Finding</th><th>Choose</th></tr></thead><tbody>{ranking.rows.map(c=><tr key={c.id}><td>{c.id} · {c.result.type==='nt'?'N-terminal':c.result.type==='ct'?'C-terminal':'knockout'}<br/>{c.result.gs.map(g=>g.sp).join(' + ')}</td><td>{c.eligible?'Passed for comparison':c.reasons.join(' ')}{knockout&&<><br/>Native tier: {c.nativeTier||'Not assessed'}; weaker-guide LoF: {Number.isFinite(c.nativeLof)?`${c.nativeLof}%`:'Not assessed'}</>}</td><td>{number(c.metrics?.[knockout?'remainingRna':'rnaDisturbance'])}</td>{!knockout&&<><td>{number(c.metrics?.usage)}</td><td>{number(c.metrics?.sites)}</td></>}<td>{number(c.metrics?.neighbor)}</td><td>{ranking.recommendedId===c.id?'Recommended for validation':ranking.frontier.includes(c.id)?'Comparative frontier':c.review?'Reviewed':c.error||'Not reviewed'}</td><td><button type="button" className="btn btn-secondary" disabled={busy||parentBusy||!c.eligible||!c.review} onClick={()=>apply(c.id)}>{saved?.appliedId===c.id?'Applied':'Use this design'}</button></td></tr>)}</tbody></table></div>
   <details><summary>Comparison methods and remaining checks</summary><p>{knockout?'Eligible pairs must retain robust native disruption assessment and a predicted frameshift. Lower remaining target RNA and neighbouring-gene disturbance are comparative evidence; larger splice disruption is not treated as guaranteed protein loss.':'Native cassette/frame validation and strong protection against each selected guide are required. Lower host RNA disturbance, splice usage/site changes and neighbouring-gene disturbance are compared without combining incompatible assay units.'} Designs on the frontier cannot be improved on every assessed axis by another tested design. Missing predictions prevent a complete recommendation. Protein domains and localization are not independently verified; terminal requirements are supplied by you.</p><p>Only a bounded native candidate set is tested. Unavailable native LoF predictions are not invented. Guide/primer specificity, personal variants, repair outcomes, protein function and reporter activity require additional validation. Predictions for large synthetic insertions are less established than for small variants. <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC2447138/" target="_blank" rel="noopener noreferrer">2A mechanism study</a> · <a href="https://www.alphagenomedocs.com/faqs.html" target="_blank" rel="noopener noreferrer">AlphaGenome limitations</a>.</p>{plan.attempts.length>0&&<ul>{plan.attempts.map((a,i)=><li key={i}>Unavailable alternative: {a.reason}</li>)}</ul>}</details>
   <p>Applying a design updates the selected reagents and report. Save the experiment to retain this comparison.</p>
  </>}
 </section>;
}
