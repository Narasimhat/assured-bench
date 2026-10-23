import { parseCsv } from './sheet.js';

export function readIceCsv(text) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers?.length || !rows.length) throw Error('The results file needs a header and at least one result row.');
  if (rows.some(r => r.length !== headers.length)) throw Error('Inconsistent CSV columns. Save the results as comma-separated CSV or tab-separated TSV.');
  return { headers, rows };
}

export function readIceMap(text) {
  const map = JSON.parse(text);
  if (map.schema !== 'assured-qc-ice-export/1' || !Array.isArray(map.rows) || !map.rows.length) throw Error('Choose sample_map.json from the original ICE export package.');
  const labels = new Set();
  for (const row of map.rows) {
    if (typeof row.label !== 'string' || !row.label || labels.has(row.label) || typeof row.sample !== 'string' || !row.assuredQc) throw Error('Invalid or duplicate labels in sample map.');
    labels.add(row.label);
  }
  return map;
}

export const ICE_FIELDS = { label: 'ICE label', hdr: 'ICE HDR', editing: 'ICE editing score', ko: 'ICE KO score', r2: 'ICE fit R²', status: 'ICE status / warnings' };
export function suggestIceColumns(headers) {
  const aliases = { label: ['label', 'sample', 'sample name'], hdr: ['hdr', 'hdr pct', 'hdr percentage', 'hdr %'], editing: ['ice', 'ice score', 'ice editing score', 'editing efficiency'], ko: ['ko', 'ko score', 'knockout score'], r2: ['r2', 'r squared', 'r²'], status: ['status', 'warnings', 'warning', 'notes'] };
  const norm = s => s.trim().toLowerCase().replace(/[_-]/g, ' ');
  return Object.fromEntries(Object.entries(aliases).map(([k, names]) => [k, headers.findIndex(h => names.includes(norm(h)))]));
}

export function compareIce(table, map, columns, units = 'percent', r2Units = 'fraction') {
  if (!Number.isInteger(columns.label) || columns.label < 0 || columns.label >= table.headers.length) throw Error('Select the ICE label column.');
  const selected = Object.values(columns).filter(i => i >= 0);
  if (new Set(selected).size !== selected.length) throw Error('Choose a different column for each field.');
  const byLabel = new Map(map.rows.map(r => [r.label, r]));
  const counts = new Map();
  table.rows.forEach(r => { const label = r[columns.label]?.trim(); counts.set(label, (counts.get(label) || 0) + 1); });
  const matched = new Set();
  const rows = table.rows.map((cells, i) => {
    const label = cells[columns.label]?.trim() || '', source = byLabel.get(label), issues = [];
    if (!source) issues.push('No exact label match');
    if (counts.get(label) > 1) issues.push('Duplicate ICE label: comparison withheld');
    const valid = source && counts.get(label) === 1;
    if (valid) matched.add(label);
    const ice = {};
    for (const key of ['hdr', 'editing', 'ko', 'r2']) {
      const raw = columns[key] >= 0 ? String(cells[columns[key]] ?? '').trim() : '';
      if (!raw || /^(na|n\/a|nan|null|none|-)$/i.test(raw)) { ice[key] = null; continue; }
      const percent = raw.endsWith('%'), value = Number(percent ? raw.slice(0, -1).trim() : raw);
      const normalized = key === 'r2' ? value / ((percent || r2Units === 'percent') ? 100 : 1) : value * ((!percent && units === 'fraction') ? 100 : 1);
      if (!Number.isFinite(value) || normalized < 0 || normalized > (key === 'r2' ? 1 : 100)) { issues.push(`Invalid ${ICE_FIELDS[key]}: ${raw}`); ice[key] = null; }
      else ice[key] = normalized;
    }
    ice.status = columns.status >= 0 ? String(cells[columns.status] ?? '') : '';
    return { row: i + 2, label, source: valid ? source : null, ice, issues };
  });
  return { rows, missing: map.rows.filter(r => !matched.has(r.label)) };
}

export function comparisonCsv(comparison) {
  const headers = ['ICE label', 'Sample', 'Read', 'Donor model', 'Assured QC native full-donor %', 'Assured QC indel %', 'Assured QC KO proxy %', 'Assured QC fit R2', 'Assured QC decision', 'ICE HDR %', 'ICE editing score %', 'ICE KO score %', 'ICE fit R2', 'ICE status', 'Import issues'];
  const rows = comparison.rows.map(r => { const a = r.source?.assuredQc, s = a?.ok ? a.summary : null; return [r.label, r.source?.sample, r.source?.read, r.source?.donorName, s?.intendedEditPct, s?.indelPct, s?.koScorePct, a?.quality?.r2, a?.decision?.decision, r.ice.hdr, r.ice.editing, r.ice.ko, r.ice.r2, r.ice.status, r.issues.join('; ')]; });
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  return [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
}
