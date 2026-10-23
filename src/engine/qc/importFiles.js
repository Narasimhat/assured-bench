import { classifyFiles } from './quick.js';

// Expand sequencing ZIPs locally, retaining filenames used by sample sheets.
export async function expandImportFiles(list) {
  const files = [], skipped = []; let total = 0;
  const supported = name => classifyFiles([name]).other.length === 0;
  for (const file of Array.from(list || [])) {
    if (!/\.zip$/i.test(file.name)) {
      if (supported(file.name)) files.push(file); else skipped.push(file.name);
      continue;
    }
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const name = entry.name.split('/').pop();
      if (!supported(name) || entry.name.startsWith('__MACOSX/')) { skipped.push(entry.name); continue; }
      const data = await entry.async('uint8array'); total += data.byteLength;
      if (total > 200_000_000 || files.length >= 2000) throw new Error('Archive is too large. Extract it and add the AB1 folder directly.');
      files.push(new File([data], name));
    }
  }
  return { files, skipped };
}
