import { specNuclease } from "./nucleases.js";
// ICE batch template verified at https://ice.editco.bio/misc/ice_example_files.zip, 2026-10-13.
// One donor per ICE row. Repeated rows are alternative fits, never biological replicates.
export const ICE_HEADERS = ['Label', 'Control File', 'Experiment File', 'Guide Sequence', 'Donor Sequence'];
export function planIceExport(tasks, results = []) {
  const rows = [], excluded = [];
  tasks.forEach((t, index) => {
    const reject = reason => excluded.push({ sample: t.name, reason });
    const guides = (t.spec?.guides || []).map(g => String(g.spacer || '').toUpperCase().replaceAll('U', 'T'));
    let nuclease;
    try { nuclease = specNuclease({ ...t.spec, nuclease: t.spec?.nuclease || t.nuclease }); }
    catch (error) { return reject(error.message); }
    if (nuclease !== 'SpCas9') return reject(`The verified ICE batch template has no nuclease column. ${nuclease} needs manual setup in ICE.`);
    if (!guides.length || guides.length > 3 || guides.some(g => !/^[ACGT]{17,23}$/.test(g))) return reject('ICE needs 1–3 explicit guide sequences, each 17–23 nt without PAM. Inferred cuts cannot be exported.');
    if (!t.controls?.length || !t.edited?.length) return reject('Missing WT or edited trace.');
    if (!['knockout', 'deletion', 'snp', 'tag_small'].includes(t.workflow)) return reject('This workflow is not supported by this ICE batch exporter.');
    const donors = t.spec?.donors || [];
    if (['snp', 'tag_small'].includes(t.workflow) && !donors.length) return reject('The analysed design has no donor sequence.');
    if (donors.some(d => !/^[ACGT]{16,300}$/i.test(d.sequence || ''))) return reject('Each ICE donor must contain 16–300 DNA bases, including homology arms.');
    // Preserve design order: donor i belongs to guide i, even for identical donors.
    if (donors.length && guides.length > 1 && donors.length !== guides.length) return reject('Guide/donor counts differ. Export each design separately with its matched guide and donor.');
    const unique = guides.length === 1 ? [...new Map(donors.map(d => [d.sequence.toUpperCase(), d])).values()] : donors;
    (unique.length ? unique : [null]).forEach((donor, di) => {
      const guideModels = donor ? [{ guide: guides[guides.length === 1 ? 0 : di], gi: guides.length === 1 ? 0 : di }] : [{ guide: guides.join(','), gi: null }];
      guideModels.forEach(({ guide, gi }) => {
      t.edited.forEach((edited, ri) => {
        const sampleLabel = String(t.name).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'sample';
        const label = `${sampleLabel}__S${String(index + 1).padStart(4, '0')}_R${ri + 1}_D${donor ? di + 1 : 0}${donor ? `_G${gi + 1}` : ''}`;
        rows.push({ label, sample: t.name, taskIndex: index, sampleType: t.sampleType, read: ri + 1,
          control: t.controls[ri] || t.controls[0], edited, guides: guide, guideIndex: gi === null ? null : gi + 1, donor: donor?.sequence.toUpperCase() || '',
          donorName: donor?.name || (donor ? `Donor ${di + 1}` : 'No donor'), donorIndex: donor ? di + 1 : null,
          alternativeModel: unique.length > 1 || (Boolean(donor) && guides.length > 1), nuclease,
          assuredQc: { ok: results[index]?.ok ?? null, decision: results[index]?.decision ?? null, summary: results[index]?.summary ?? null, quality: results[index]?.quality ?? null },
          warnings: [...(t.planNotes || []), ...(results[index]?.warnings || [])] });
      });
      });
    });
  });
  return { rows, excluded, samples: new Set(rows.map(r => r.taskIndex)).size };
}

const xml = v => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const csv = rows => rows.map(r => r.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
// Literal text cells prevent sample labels from becoming Excel formulas.
async function workbook(JSZip, rows) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + [ICE_HEADERS, ...rows].map((row, i) => `<row r="${i + 1}">` + row.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('') + '</row>').join('') + '</sheetData></worksheet>');
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function buildIceBundle({ tasks, results, getBytes, rowsPerBatch = 96, maxBytes = 200_000_000, created = new Date().toISOString() }) {
  if (!Number.isInteger(rowsPerBatch) || rowsPerBatch < 1 || rowsPerBatch > 700) throw Error('Choose 1–700 rows per batch.');
  const plan = planIceExport(tasks, results);
  if (!plan.rows.length) throw Error('No compatible samples. ' + plan.excluded.map(e => `${e.sample}: ${e.reason}`).join(' '));
  const { default: JSZip } = await import('jszip');
  const bundle = new JSZip(), files = new Map();
  for (const name of new Set(plan.rows.flatMap(r => [r.control, r.edited]))) {
    const bytes = new Uint8Array(await getBytes(name));
    if (bytes.length < 4 || String.fromCharCode(...bytes.slice(0, 4)) !== 'ABIF') throw Error(`Missing or invalid AB1 trace: ${name}`);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    files.set(name, { bytes, hash, exportName: `trace_${String(files.size + 1).padStart(4, '0')}.ab1` });
  }
  const batches = []; let current = [], used = new Set(), size = 0;
  // Keep each single-guide/donor model in its own upload batch.
  plan.rows.sort((a, b) => (a.donorIndex || 0) - (b.donorIndex || 0) || `${a.guides}|${a.donor}`.localeCompare(`${b.guides}|${b.donor}`));
  for (const row of plan.rows) {
    const names = [...new Set([row.control, row.edited])];
    const added = names.filter(n => !used.has(n)).reduce((s, n) => s + files.get(n).bytes.length + 200, 0);
    if (current.length && ((current[0].guides !== row.guides || current[0].donor !== row.donor) || current.length >= rowsPerBatch || size + added > maxBytes || new Set([...used, ...names]).size > 700)) { batches.push(current); current = []; used = new Set(); size = 0; }
    for (const n of names) if (!used.has(n)) { used.add(n); size += files.get(n).bytes.length + 200; }
    if (size > maxBytes) throw Error(`Trace pair too large for an ICE batch: ${row.sample}`);
    current.push(row);
  }
  if (current.length) batches.push(current);
  for (const [i, rows] of batches.entries()) {
    const folder = `batch_${String(i + 1).padStart(3, '0')}${rows[0].donor ? `_gRNA${rows[0].guideIndex}_ssODN${rows[0].donorIndex}` : ''}`; const traces = new JSZip();
    for (const name of new Set(rows.flatMap(r => [r.control, r.edited]))) traces.file(files.get(name).exportName, files.get(name).bytes);
    bundle.file(`${folder}/ab1_files.zip`, await traces.generateAsync({ type: 'uint8array', compression: 'STORE' }));
    bundle.file(`${folder}/ice_definitions.xlsx`, await workbook(JSZip, rows.map(r => [r.label, files.get(r.control).exportName, files.get(r.edited).exportName, r.guides, r.donor])));
    rows.forEach(r => { r.batch = folder; });
  }
  const manifest = { schema: 'assured-qc-ice-export/1', created, target: 'https://ice.editco.bio/#/', templateVerified: '2026-10-13', samples: plan.samples, rows: plan.rows, excluded: plan.excluded,
    files: [...files].map(([originalName, f]) => ({ originalName, exportedName: f.exportName, sha256: f.hash })),
    interpretation: 'Donor rows are alternative fits of the same trace, not replicates or a joint two-donor model. Do not add or average their HDR percentages.' };
  bundle.file('sample_map.json', JSON.stringify(manifest, null, 2));
  bundle.file('sample_map.csv', csv([['ICE label', 'Assured QC sample', 'Read', 'Donor', 'Batch', 'Original control', 'Original edited', 'Alternative model'], ...plan.rows.map(r => [r.label, r.sample, r.read, r.donorName, r.batch, r.control, r.edited, r.alternativeModel])]));
  bundle.file('START_HERE.txt', `ICE comparison package\n\n1. Extract this outer ZIP into a folder on your computer.\n2. Open https://ice.editco.bio/#/ and choose Batch Upload.\n3. For each batch folder, upload ab1_files.zip on the left and ice_definitions.xlsx on the right. Do not upload this outer package.\n4. Save ICE results beside that batch. Use sample_map.csv to match labels back to your samples.\n\n${plan.samples} samples, ${plan.rows.length} ICE rows, ${batches.length} batches.\nDonor models use exactly one guide and one donor per row. Matched design pairs are exported separately in design order: gRNA1 with ssODN1, gRNA2 with ssODN2. Check this order against your design before uploading. Unequal guide/donor counts require separate designs; a single guide can be compared with multiple donors. Multi-guide designs without donors retain all analysed guides. Read pairs are exported separately. Identical donor sequences paired with different guides remain separate models. These are alternative models, not independent samples or a simultaneous two-donor fit. Never add or average donor HDR scores. ICE donor HDR is not necessarily the intended amino-acid-change fraction. Inspect fit quality and chromatograms. Homology arms must each align for at least 15 bases; ICE validates the alignment.\n\nFiles are packaged locally. Uploading them to ICE shares them with EditCo and is a separate action you perform.\n\nExcluded samples (${plan.excluded.length}):\n${plan.excluded.map(e => `${e.sample}: ${e.reason}`).join('\n') || 'None'}\n\nTemplate: https://ice.editco.bio/misc/ice_example_files.zip (checked 2026-10-13).\n`);
  return { bytes: await bundle.generateAsync({ type: 'uint8array', compression: 'STORE' }), manifest, batches: batches.length };
}
