import { useState } from 'react';
import { planIceExport, buildIceBundle } from './iceExport.js';
import IceImport from './IceImport.jsx';

export default function IceExport({ tasks, results, getBytes }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [batchSize, setBatchSize] = useState(96);
  const plan = planIceExport(tasks, results);
  const download = async () => {
    setBusy(true); setMessage('');
    try {
      const out = await buildIceBundle({ tasks, results, getBytes, rowsPerBatch: batchSize });
      const url = URL.createObjectURL(new Blob([out.bytes], { type: 'application/zip' }));
      const a = document.createElement('a'); a.href = url; a.download = `assured_qc_ICE_${new Date().toISOString().slice(0, 10)}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage(`Downloaded ${out.manifest.samples} sample${out.manifest.samples === 1 ? '' : 's'} as ${out.manifest.rows.length} ICE rows in ${out.batches} batch folder(s). Extract the ZIP and follow START_HERE.txt.`);
    } catch (e) { setMessage(`Export failed: ${e.message}`); }
    finally { setBusy(false); }
  };
  return <details className="ice-export"><summary><b>Compare with ICE</b></summary>
    <p>{plan.samples} sample{plan.samples === 1 ? '' : 's'} · {plan.rows.length} ICE rows. HDR comparison uses one guide and one donor per row, paired in design order: gRNA1 + ssODN1, gRNA2 + ssODN2. Check the pairings below before uploading. WT pairing is preserved. These are alternative models; do not add their HDR scores.</p>
    {Array.from(new Map(plan.rows.filter(r => r.donor).map(r => [`${r.guides}|${r.donor}`, r])).values()).map(r => <details key={`${r.guides}|${r.donor}`}><summary>gRNA{r.guideIndex} + ssODN{r.donorIndex} ({r.donorName})</summary><p>Guide: <code>{r.guides}</code></p><p style={{overflowWrap: 'anywhere'}}>Donor: <code>{r.donor}</code></p></details>)}
    <p>Two donors are compared as separate models. Do not add their HDR percentages. ICE HDR and intended amino-acid editing can measure different outcomes.</p>
    <label>Rows per ICE batch <select value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} disabled={busy}><option value={96}>96</option><option value={20}>20 (smaller uploads)</option><option value={700}>700</option></select></label>
    <p><button type="button" onClick={download} disabled={busy || !plan.rows.length}>{busy ? 'Preparing ICE package…' : 'Download ICE batch folder (ZIP)'}</button> <a href="https://ice.editco.bio/#/" target="_blank" rel="noreferrer">Open ICE</a></p>
    <p className="muted">Extract the download, then upload the AB1 ZIP and Excel workbook from each batch folder to ICE. The package also saves sample labels, input hashes and Assured QC scores. Nothing is sent to ICE by this button.</p>
    {plan.excluded.length > 0 && <div role="note"><b>{plan.excluded.length} samples excluded</b><ul>{plan.excluded.map((e, i) => <li key={i}>{e.sample}: {e.reason}</li>)}</ul></div>}
    {message && <p role="status">{message}</p>}
    <IceImport />
  </details>;
}
