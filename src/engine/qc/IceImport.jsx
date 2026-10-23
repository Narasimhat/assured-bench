import { useState } from 'react';
import { readIceCsv, readIceMap, suggestIceColumns, compareIce, comparisonCsv, ICE_FIELDS } from './iceImport.js';

const value = (v, suffix = '%') => typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(suffix ? 1 : 3)}${suffix}` : '—';
export default function IceImport() {
  const [table, setTable] = useState(null), [map, setMap] = useState(null), [columns, setColumns] = useState({});
  const [units, setUnits] = useState('percent'), [r2Units, setR2Units] = useState('fraction');
  const [error, setError] = useState(''), [comparison, setComparison] = useState(null);
  const load = async (file, kind) => {
    setError(''); setComparison(null);
    if (kind === 'map') setMap(null); else { setTable(null); setColumns({}); }
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw Error('Please select a results file smaller than 10 MB.');
      const text = await file.text();
      if (kind === 'map') setMap(readIceMap(text));
      else { const t = readIceCsv(text); setTable(t); setColumns(suggestIceColumns(t.headers)); }
    } catch (e) { setError(e.message); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([comparisonCsv(comparison)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'assured_qc_ICE_comparison.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return <section aria-label="Import ICE comparison">
    <h3>Bring ICE results back</h3>
    <p>Select the original export’s sample map and the ICE results CSV or TSV. If your results are in Excel, save the results sheet as CSV first. Files stay in this browser.</p>
    <p><label>Original sample_map.json <input type="file" accept=".json" onChange={e => load(e.target.files[0], 'map')} /></label></p>
    <p><label>ICE results CSV or TSV <input type="file" accept=".csv,.tsv" onChange={e => load(e.target.files[0], 'results')} /></label></p>
    {map && <p>Original export: {map.created || 'date not recorded'} · {map.rows.length} expected ICE rows. Assured QC values below come from this saved export.</p>}
    {table && <>
      <p>Review the suggested columns. Leave unavailable scores unselected; missing values remain blank.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{Object.entries(ICE_FIELDS).map(([key, label]) => <label key={key}>{label} <select value={columns[key] ?? -1} onChange={e => { setColumns({ ...columns, [key]: Number(e.target.value) }); setComparison(null); }}><option value={-1}>Not provided</option>{table.headers.map((h, i) => <option key={i} value={i}>{h} (column {i + 1})</option>)}</select></label>)}</div>
      <p><label>ICE score units <select value={units} onChange={e => { setUnits(e.target.value); setComparison(null); }}><option value="percent">Percent (0–100)</option><option value="fraction">Fraction (0–1)</option></select></label> <label>ICE R² units <select value={r2Units} onChange={e => { setR2Units(e.target.value); setComparison(null); }}><option value="fraction">Fraction (0–1)</option><option value="percent">Percent (0–100)</option></select></label></p>
      <button type="button" disabled={!map} onClick={() => { try { setComparison(compareIce(table, map, columns, units, r2Units)); setError(''); } catch (e) { setComparison(null); setError(e.message); } }}>Compare results</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {comparison && <>
      <p role="status">{comparison.rows.filter(r => r.source).length} rows matched · {comparison.rows.filter(r => !r.source).length} unmatched or ambiguous · {comparison.missing.length} expected rows without a unique result.</p>
      <p>Each donor remains a separate ICE model. Assured QC scores describe the original sample analysis and are repeated for context; they are not donor-specific refits. Native full-donor %, intended amino-acid efficiency, ICE HDR, editing scores and KO proxies can describe different outcomes. No scores are added or averaged, and no clone decision is changed by this comparison.</p>
      <button type="button" onClick={download}>Download comparison CSV</button>
      <div style={{ overflowX: 'auto' }}><table><thead><tr>{['Sample / read / donor', 'Assured QC full-donor', 'ICE HDR', 'Assured QC indels', 'ICE editing', 'Assured QC KO proxy', 'ICE KO', 'Fit R²: Assured / ICE', 'Status / warnings'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{comparison.rows.map((r, i) => {
        const a = r.source?.assuredQc, s = a?.ok ? a.summary : null;
        return <tr key={i}><td>{r.source ? `${r.source.sample} / read ${r.source.read} / ${r.source.donorName}` : r.label}<small style={{ display: 'block' }}>{r.label}</small></td><td>{value(s?.intendedEditPct)}</td><td>{value(r.ice.hdr)}</td><td>{value(s?.indelPct)}</td><td>{value(r.ice.editing)}</td><td>{value(s?.koScorePct)}</td><td>{value(r.ice.ko)}</td><td>{value(a?.quality?.r2, '')} / {value(r.ice.r2, '')}</td><td>{[a && (a.ok ? a.decision?.decision : 'Assured QC failed'), r.ice.status, ...(r.source?.warnings || []), ...r.issues].filter(Boolean).join('; ') || 'No status provided'}</td></tr>;
      })}</tbody></table></div>
      {comparison.missing.length > 0 && <details><summary>Missing or ambiguous ICE results</summary><ul>{comparison.missing.map(r => <li key={r.label}>{r.label}</li>)}</ul></details>}
    </>}
  </section>;
}
