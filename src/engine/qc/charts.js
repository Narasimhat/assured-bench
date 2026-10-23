// Small SVG charts (no dependencies); every label is escaped.
const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLORS = { wt: "#667085", indel: "#d92d20", deletion_between_cuts: "#b54708", edit: "#067647", edit_partial: "#7a5af8", noise: "#98a2b3" };

export function contributionsSvg(contributions, { width = 640, rows = 10 } = {}) {
  const shown = contributions.slice(0, rows);
  if (!shown.length) return "";
  const rowH = 22; const labelW = 300; const barW = width - labelW - 60; const height = shown.length * rowH + 22;
  const bars = shown.map((c, i) => {
    const y = 10 + i * rowH; const w = Math.max(1, c.fraction * barW);
    const label = `${c.label}${c.indistinguishable ? ` (+${c.indistinguishable} alike)` : ""}`.slice(0, 52);
    return `<text x="${labelW - 6}" y="${y + 13}" text-anchor="end" font-size="11" fill="#344054">${esc(label)}</text><rect x="${labelW}" y="${y + 2}" width="${w.toFixed(1)}" height="14" fill="${COLORS[c.kind] || "#667085"}" rx="2"/><text x="${labelW + w + 5}" y="${y + 13}" font-size="11" fill="#344054">${(c.fraction * 100).toFixed(1)}%</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Allele contributions" font-family="Arial, Helvetica, sans-serif">${bars}</svg>`;
}

export function discordanceSvg(prepared, { width = 640, height = 150 } = {}) {
  const d = prepared.discordance; const n = d.length;
  const from = Math.max(0, prepared.alignmentWindow.start - 10); const to = Math.min(n, prepared.window.end + 40);
  const pl = 36; const pr = 10; const pt = 10; const pb = 26; const w = width - pl - pr; const h = height - pt - pb;
  const x = (j) => pl + ((j - from) / Math.max(1, to - from - 1)) * w; const y = (v) => pt + (1 - Math.min(1, v)) * h;
  let path = ""; let pen = false;
  for (let j = from; j < to; j += 1) { if (Number.isNaN(d[j])) { pen = false; continue; } path += `${pen ? "L" : "M"}${x(j).toFixed(1)},${y(d[j]).toFixed(1)}`; pen = true; }
  const cuts = prepared.cuts.map((c) => `<line x1="${x(c.readIndex).toFixed(1)}" x2="${x(c.readIndex).toFixed(1)}" y1="${pt}" y2="${pt + h}" stroke="#7a5af8" stroke-width="1.2" stroke-dasharray="4 3"/><text x="${(x(c.readIndex) + 3).toFixed(1)}" y="${pt + 10}" font-size="10" fill="#7a5af8">cut</text>`).join("");
  const win = `<rect x="${x(prepared.window.start).toFixed(1)}" y="${pt}" width="${(x(prepared.window.end) - x(prepared.window.start)).toFixed(1)}" height="${h}" fill="#eef4ff" opacity="0.7"/>`;
  const aln = `<rect x="${x(prepared.alignmentWindow.start).toFixed(1)}" y="${pt + h + 4}" width="${(x(prepared.alignmentWindow.end) - x(prepared.alignmentWindow.start)).toFixed(1)}" height="5" fill="#98a2b3"/>`;
  const ticks = [0, 0.5, 1].map((v) => `<text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="#667085">${v}</text><line x1="${pl}" x2="${pl + w}" y1="${y(v)}" y2="${y(v)}" stroke="#eaecf0"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Discordance between edited and control trace along the read" font-family="Arial, Helvetica, sans-serif">${ticks}${win}${aln}<path d="${path}" fill="none" stroke="#344054" stroke-width="1.2"/>${cuts}<text x="${pl}" y="${height - 4}" font-size="10" fill="#667085">read position (shaded: analysis window; grey bar: stretch used to align the traces)</text></svg>`;
}
