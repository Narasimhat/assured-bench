// Predicted protein products of the alleles of a clone (or of a run), drawn on the protein, with the stretches of the protein where an antibody epitope would
// see every product, or the full-length protein only. It answers the question that comes before a Western blot: which antibody can tell "no protein" from
// "a shorter protein"? Vector SVG with real text, 1 unit = 1 pixel at 96 dpi; a browser rasterises it at any dpi. No scripts and no external resources.
//
// The products come from the allele table of the functional assessment (coding.js): a premature stop gives the residues kept before the first changed residue
// plus a frameshifted tail up to the stop; an in-frame change gives the protein minus the removed residues; a splice-site loss gives its two outcomes (exon
// skipping, intron retention). Alleles whose product cannot be drawn (start codon lost, no stop codon, all exons deleted) are listed as text. Everything is
// predicted from sequence; masses are about 0.11 kDa per residue and real gels run differently.

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const KDA_PER_RESIDUE = 0.11;
const INK = "#101828"; const MUTED = "#475467"; const PRODUCT = "#1b6ca8"; const ALL = "#d95f02"; const ONLY = "#7570b3";
const kda = (aa) => `${Math.round(aa * KDA_PER_RESIDUE * 10) / 10}`.replace(/\.0$/, "");

const nmdWord = (nmd) => (!nmd ? null : nmd.predicted ? (nmd.borderline || nmd.uncertain ? "borderline" : "expected") : "escape");

function fromOutcome(base, outcome, name, protLen) {
  const d = (outcome && outcome.details) || {};
  if (d.ptcAa !== undefined) {
    const total = Math.max(0, d.ptcAa); const kept = Math.min(total, Math.max(0, d.keptAa !== undefined ? d.keptAa : (d.firstChangedAa || 1) - 1));
    return { ...base, outcome: name, kind: "truncated", kept, total, nmd: nmdWord(d.nmd), summary: outcome.summary };
  }
  if (d.diff && (d.diff.removed || d.diff.inserted)) {
    const first = d.diff.first; const removed = d.diff.removed || 0;
    return { ...base, outcome: name, kind: "inframe", kept: Math.max(0, first - 1), removed, resume: first + removed, total: protLen - removed + (d.diff.inserted || 0), nmd: null, summary: outcome.summary };
  }
  return { ...base, outcome: name, kind: "text", note: outcome ? outcome.summary : "", summary: outcome ? outcome.summary : "" };
}

/** "Deletion between cuts (79 bp)" and "Deletion between cuts (84 bp)" read "Deletion between cuts (79 bp, 84 bp)". */
export function joinAlleles(labels) {
  const parts = labels.map((l) => /^(.*?) \((.*)\)$/.exec(l)); if (labels.length === 1) return labels[0];
  if (parts.every((m) => m && m[1] === parts[0][1])) return `${parts[0][1]} (${parts.map((m) => m[2]).join(", ")})`;
  return labels.join("; ");
}

/**
 * @param {object} functional result.functional (rows, context)
 * @returns {{ proteinLength: number, exonEnds: number[], regions: Array, epitope: object|null, products: Array, notes: string[] }}
 */
export function predictedProducts(functional, { minAllele = 0.05 } = {}) {
  const ctx = (functional && functional.context) || {}; const protLen = ctx.proteinLength || 0; const rows = (functional && functional.rows) || [];
  const total = rows.reduce((s, r) => s + (r.fraction || 0), 0) || 1; const products = []; const notes = [];
  rows.filter((r) => r.class !== "wt" && (r.fraction || 0) >= minAllele).forEach((row) => {
    const base = { allele: row.label, share: (row.fraction || 0) / total, lof: row.lof };
    if (row.class === "lof_splice" || row.class === "splice_uncertain") {
      const sp = row.details && row.details.splice;
      [["skipping", `exon skipping${sp && sp.skippedExons ? ` (${sp.skippedExons})` : ""}`], ["retention", "intron retained"]].forEach(([key, name]) => {
        const o = sp && sp[key];
        if (o && o.details) products.push(fromOutcome(base, o, name, protLen)); else notes.push(`${row.label}: ${name} is not drawn (run the sample again with this version for the details).`);
      });
    } else if (row.class !== "synonymous" && row.class !== "no_coding_effect") products.push(fromOutcome(base, row, "", protLen));
  });
  // alleles that give the same product (a deletion slid along a repeat, or exon skipping from different deletions) are one row
  const merged = new Map();
  products.forEach((p) => { const key = [p.outcome, p.kind, p.kept, p.total, p.nmd, p.removed, p.kind === "text" ? p.allele + p.summary : ""].join("|"); if (merged.has(key)) { const m = merged.get(key); m.share += p.share; if (!m.alleles.includes(p.allele)) m.alleles.push(p.allele); } else merged.set(key, { ...p, alleles: [p.allele] }); });
  merged.forEach((m) => { m.allele = joinAlleles(m.alleles); });
  const lens = ctx.exonLengths || []; let run = 0; const exonEnds = lens.map((n) => { run += n; return Math.min(protLen, run / 3); });
  return { proteinLength: protLen, exonEnds, regions: ctx.regions || [], epitope: ctx.epitope || null, products: [...merged.values()], notes };
}

const retains = (p, r) => (p.kind === "truncated" ? r <= p.kept : p.kind === "inframe" ? r <= p.kept || r >= p.resume : false);
const runs = (flags) => { const out = []; let a = null; flags.forEach((f, i) => { const r = i + 1; if (f && a === null) a = r; if (!f && a !== null) { out.push([a, r - 1]); a = null; } }); if (a !== null) out.push([a, flags.length]); return out; };

/** Residues kept by every drawn product (an antibody there sees all of them) and residues kept by none of them (the full-length protein only). */
export function epitopeWindows(products, proteinLength) {
  const drawn = products.filter((p) => p.kind === "truncated" || p.kind === "inframe"); if (!drawn.length || !proteinLength) return null;
  const all = []; const only = [];
  for (let r = 1; r <= proteinLength; r += 1) { all.push(drawn.every((p) => retains(p, r))); only.push(!drawn.some((p) => retains(p, r))); }
  return { all: runs(all), only: runs(only), drawn: drawn.length };
}
const rangeText = (rs) => rs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");

function ticks(max) { const step = max > 400 ? 100 : max > 150 ? 50 : 25; const out = [1]; for (let v = step; v < max; v += step) out.push(v); out.push(max); return out; }

/** The figure. `data` is the result of predictedProducts (or a merge of several). */
export function drawProteinProducts(data, { title = "", showShare = true, width = 840, idSuffix = "", maxRows = 14 } = {}) {
  const protLen = data.proteinLength; if (!protLen) return null;
  const X0 = 14; const PW = width - 28; const x = (aa) => X0 + (Math.max(0, Math.min(protLen, aa)) / protLen) * PW;
  const win = epitopeWindows(data.products, protLen); const hatch = `hatch${idSuffix}`;
  const parts = []; let y = 6;
  if (title) { parts.push(`<text x="${X0}" y="${y + 13}" font-size="13" fill="${INK}">${esc(title)}</text>`); y += 24; }
  // tracks: domains the user marked, coding exons
  if (data.regions.length) {
    parts.push(`<text x="${X0}" y="${y + 10}" font-size="10" fill="${MUTED}">Marked regions</text>`); y += 14;
    data.regions.forEach((r, i) => { const x1 = x(r.start - 1); const x2 = x(r.end); parts.push(`<rect x="${x1.toFixed(1)}" y="${y}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="18" fill="${["#c9ccd1", "#a9adb4", "#e3e5e8"][i % 3]}"/><text x="${((x1 + x2) / 2).toFixed(1)}" y="${y + 13}" font-size="11" text-anchor="middle" fill="${INK}">${esc(r.name)}</text>`); });
    y += 26;
  }
  if (data.exonEnds.length) {
    parts.push(`<text x="${X0}" y="${y + 10}" font-size="10" fill="${MUTED}">Coding exons</text>`); y += 14; let prev = 0;
    data.exonEnds.forEach((end, i) => { const x1 = x(prev); const x2 = x(end); parts.push(`<rect x="${x1.toFixed(1)}" y="${y}" width="${Math.max(0.5, x2 - x1).toFixed(1)}" height="14" fill="${i % 2 ? "#d9dce1" : "#eceef1"}"/>${x2 - x1 > 14 ? `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y + 11}" font-size="10" text-anchor="middle" fill="${MUTED}">${i + 1}</text>` : ""}`); prev = end; });
    y += 24;
  }
  const rows = [{ kind: "full", label: `Full-length protein: ${protLen} aa, about ${kda(protLen)} kDa` }];
  const drawn = data.products.slice(0, maxRows);
  drawn.forEach((p) => rows.push(p));
  const top = y;
  const heights = rows.map((p) => (p.kind === "text" ? 22 : 44)); const bodyH = heights.reduce((s, h) => s + h, 0);
  // antibody windows behind the products
  if (win) {
    win.all.forEach(([a, b]) => parts.push(`<rect x="${x(a - 1).toFixed(1)}" y="${top - 4}" width="${Math.max(1, x(b) - x(a - 1)).toFixed(1)}" height="${bodyH + 4}" fill="${ALL}" fill-opacity="0.12"/>`));
    win.only.forEach(([a, b]) => parts.push(`<rect x="${x(a - 1).toFixed(1)}" y="${top - 4}" width="${Math.max(1, x(b) - x(a - 1)).toFixed(1)}" height="${bodyH + 4}" fill="${ONLY}" fill-opacity="0.12"/>`));
  }
  let yy = top;
  rows.forEach((p, i) => {
    const label = p.kind === "full" ? p.label : (() => {
      const share = showShare && p.share < 0.95 ? ` (${Math.round(p.share * 100)}% of the signal)` : "";
      const tail = p.kind === "text" ? "" : `${p.outcome ? `${p.outcome}, ` : ""}${p.total} aa, about ${kda(p.total)} kDa`;
      return p.kind === "text" ? `${p.allele}${share}${p.outcome ? ` (${p.outcome})` : ""}: ${p.note}` : `${p.allele}${share}: ${tail}${p.kind === "inframe" ? `; ${p.removed} residue${p.removed === 1 ? "" : "s"} removed at residue ${p.kept + 1}` : ""}`;
    })();
    if (p.kind === "text") { parts.push(`<text x="${X0}" y="${yy + 14}" font-size="11" fill="${MUTED}">${esc(label.length > 170 ? `${label.slice(0, 167)}...` : label)}</text>`); yy += heights[i]; return; }
    parts.push(`<text x="${X0}" y="${yy + 12}" font-size="11" fill="${INK}">${esc(label)}</text>`);
    const by = yy + 18;
    if (p.kind === "full") parts.push(`<rect x="${x(0).toFixed(1)}" y="${by}" width="${(x(protLen) - x(0)).toFixed(1)}" height="14" fill="${PRODUCT}"/>`);
    else if (p.kind === "truncated") {
      if (p.kept > 0) parts.push(`<rect x="${x(0).toFixed(1)}" y="${by}" width="${(x(p.kept) - x(0)).toFixed(1)}" height="14" fill="${PRODUCT}"/>`);
      if (p.total > p.kept) parts.push(`<rect x="${x(p.kept).toFixed(1)}" y="${by}" width="${Math.max(1, x(p.total) - x(p.kept)).toFixed(1)}" height="14" fill="url(#${hatch})" stroke="${PRODUCT}" stroke-width="1"${p.nmd === "expected" || p.nmd === "borderline" ? ' stroke-dasharray="3 2"' : ""}/>`);
      const note = p.nmd === "expected" ? "NMD expected" : p.nmd === "borderline" ? "NMD borderline" : p.nmd === "escape" ? "escapes NMD: protein expected" : "";
      if (note) parts.push(`<text x="${(x(p.total) + 6).toFixed(1)}" y="${by + 11}" font-size="10" fill="${MUTED}">${esc(note)}</text>`);
    } else if (p.kind === "inframe") {
      if (p.kept > 0) parts.push(`<rect x="${x(0).toFixed(1)}" y="${by}" width="${(x(p.kept) - x(0)).toFixed(1)}" height="14" fill="${PRODUCT}"/>`);
      if (p.removed > 0) parts.push(`<rect x="${x(p.kept).toFixed(1)}" y="${by}" width="${Math.max(1, x(p.kept + p.removed) - x(p.kept)).toFixed(1)}" height="14" fill="none" stroke="${PRODUCT}" stroke-width="1" stroke-dasharray="2 2"/>`);
      if (p.resume <= protLen) parts.push(`<rect x="${x(p.resume - 1).toFixed(1)}" y="${by}" width="${Math.max(1, x(protLen) - x(p.resume - 1)).toFixed(1)}" height="14" fill="${PRODUCT}"/>`);
    }
    yy += heights[i];
  });
  y = yy + 6;
  // axis
  parts.push(`<line x1="${X0}" y1="${y}" x2="${X0 + PW}" y2="${y}" stroke="${INK}" stroke-width="1"/>`);
  ticks(protLen).forEach((v) => parts.push(`<line x1="${x(v).toFixed(1)}" y1="${y}" x2="${x(v).toFixed(1)}" y2="${y + 4}" stroke="${INK}" stroke-width="1"/><text x="${x(v).toFixed(1)}" y="${y + 15}" font-size="10" text-anchor="middle" fill="${INK}">${v}</text>`));
  y += 34; parts.push(`<text x="${X0}" y="${y - 8}" font-size="10" fill="${MUTED}">Residue number in the protein of the gene record</text>`);
  // what the shaded stretches mean
  if (win) {
    parts.push(`<rect x="${X0}" y="${y}" width="11" height="11" fill="${ALL}" fill-opacity="0.25"/><text x="${X0 + 16}" y="${y + 10}" font-size="11" fill="${INK}">${win.all.length ? `An epitope in residues ${esc(rangeText(win.all))} sees every product shown` : "No residue is kept by every product shown, so no single antibody sees them all"}</text>`); y += 18;
    parts.push(`<rect x="${X0}" y="${y}" width="11" height="11" fill="${ONLY}" fill-opacity="0.25"/><text x="${X0 + 16}" y="${y + 10}" font-size="11" fill="${INK}">${win.only.length ? `An epitope in residues ${esc(rangeText(win.only))} sees the full-length protein only` : "Every residue is kept by some product, so a shorter product can hide behind any antibody"}</text>`); y += 18;
  }
  if (data.epitope) {
    const e = data.epitope; const kept = data.products.filter((p) => (p.kind === "truncated" || p.kind === "inframe") && (p.kind === "truncated" ? e.end <= p.kept : (e.end <= p.kept || e.start >= p.resume))).length; const n = data.products.filter((p) => p.kind === "truncated" || p.kind === "inframe").length;
    parts.push(`<rect x="${x(e.start - 1).toFixed(1)}" y="${top - 8}" width="${Math.max(1, x(e.end) - x(e.start - 1)).toFixed(1)}" height="${bodyH + 8 + 6}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${X0}" y="${y + 10}" font-size="11" fill="${INK}">Your antibody epitope (residues ${e.start}-${e.end}, dashed box) is kept by ${kept} of ${n} products shown and by the full-length protein.</text>`); y += 18;
  }
  const extra = data.products.length - drawn.length; const notes = [...(data.notes || [])]; if (extra > 0) notes.push(`${extra} more product${extra === 1 ? "" : "s"} not drawn.`);
  [`Solid: original sequence. Hatched: frameshifted tail (new sequence). Dashed outline: NMD expected or borderline, so the product may not be made.`, `Predicted from sequence only; masses are about ${KDA_PER_RESIDUE} kDa per residue and real gels run differently.`].forEach((line) => { parts.push(`<text x="${X0}" y="${y + 10}" font-size="10" fill="${MUTED}">${esc(line)}</text>`); y += 14; });
  y += 2;
  notes.forEach((n) => { parts.push(`<text x="${X0}" y="${y + 10}" font-size="10" fill="${MUTED}">${esc(n.length > 190 ? `${n.slice(0, 187)}...` : n)}</text>`); y += 14; });
  const height = Math.ceil(y + 8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif" role="img"><title>${esc(title || "Predicted protein products")}</title><defs><pattern id="${hatch}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="${PRODUCT}" stroke-width="1.6"/></pattern></defs><rect width="${width}" height="${height}" fill="#fff"/>${parts.join("")}</svg>`;
}

/** One clone: the products of its alleles. Returns "" when the sample has no functional assessment or nothing is predicted to change the protein. */
export function cloneProteinFigure(result, options = {}) {
  if (!result || !result.ok || !result.functional) return "";
  const data = predictedProducts(result.functional, options); if (!data.products.length && !data.notes.length) return "";
  return drawProteinProducts(data, { title: options.title ?? `Predicted protein products: ${result.name}`, idSuffix: options.idSuffix ?? "", showShare: true }) || "";
}

/** A run: every distinct allele product across the clones that share one protein, with the epitope windows over all of them. */
export function runProteinFigure(results, options = {}) {
  const withFn = (results || []).filter((r) => r && r.ok && r.functional && r.functional.context && r.functional.context.proteinLength); if (!withFn.length) return "";
  const first = withFn[0].functional.context; const same = withFn.filter((r) => r.functional.context.proteinLength === first.proteinLength && r.functional.context.transcript === first.transcript);
  const rows = []; const seen = new Set();
  same.forEach((r) => r.functional.rows.forEach((row) => { const key = `${row.label}|${row.class}`; if (!seen.has(key) && row.class !== "wt" && row.fraction >= 0.05) { seen.add(key); rows.push({ ...row, fraction: 1 }); } }));
  const data = predictedProducts({ context: first, rows }, { minAllele: 0 }); if (!data.products.length && !data.notes.length) return "";
  return drawProteinProducts(data, { title: options.title ?? `Predicted protein products of the alleles in this run (${same.length} clone${same.length === 1 ? "" : "s"})`, showShare: false, idSuffix: options.idSuffix ?? "-run" }) || "";
}
