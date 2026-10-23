// Design scheme: a publication-style schematic of a design, drawn from the design result.
//
// buildDesignSchemeSvg(result) returns a standalone SVG string (or "" when the result has no
// usable reference). buildDesignSchemeCaption(result) returns a draft figure legend written from
// the same data. Both are pure functions of the result: no React, no DOM, no dependencies, so the
// browser app, the HTML report and the CLI all draw the same figure and `node --test` can check it.
//
// Coordinates follow the engine: 0-based indices into result.gb.genomicSequence; CDS segments and
// exons are half-open [start, end); a guide's `ps` is the start of its 23-nt window (protospacer then
// PAM on the + strand, PAM then protospacer on the - strand) and `cut` is the cut edge.
//
// Panel a (all design types): guides, reference allele, donor(s), edited allele, screening PCR.
// Panel b (C- and N-terminal tags): sequence and reading frame at the insertion site.
// Panel c (C- and N-terminal tags): layout of the tagged protein.

const FONT = "Arial, Helvetica, sans-serif";
const MONO = "Consolas, 'DejaVu Sans Mono', 'Courier New', monospace";
const COLORS = {
  ink: "#1d2330", muted: "#667085", cds: "#3b4a63", utr: "#7d889c", arm: "#c9d1dc",
  guide: "#7B3FA0", pam: "#D9A400", alarm: "#D55E00", connector: "#9aa3b2", pcrWt: "#222222", pcrEdit: "#0F766E",
  native: "#3b4a63", tail: "#7d889c",
};
const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const CODONS = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L", ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V", TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A", TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q", AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R", AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

const revcomp = (seq) => String(seq).split("").reverse().map((base) => COMPLEMENT[base] || "N").join("");
const aaOf = (codon) => CODONS[codon] || "X";
const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (value) => String(Math.round(value * 100) / 100);
const fmtBp = (value) => (Math.round(value) + 0).toLocaleString("en-US");
const minus = (value) => (Math.round(value) < 0 ? `\u2212${fmtBp(-value)}` : fmtBp(value));
const finite = (value) => Number.isFinite(value);

function createCanvas(width) {
  const parts = [];
  const attrs = (o) => [
    o.fill !== undefined ? ` fill="${o.fill}"` : "",
    o.stroke ? ` stroke="${o.stroke}" stroke-width="${num(o.sw ?? 1)}"` : "",
    o.dash ? ` stroke-dasharray="${o.dash}"` : "",
    o.op !== undefined ? ` opacity="${o.op}"` : "",
  ].join("");
  return {
    width,
    rect(x, y, w, h, o = {}) {
      if (!(w > 0) || !(h > 0)) return;
      parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${attrs({ fill: "none", ...o })}${o.rx ? ` rx="${o.rx}"` : ""}/>`);
    },
    line(x1, y1, x2, y2, o = {}) {
      parts.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"${attrs({ stroke: COLORS.ink, ...o })}${o.cap ? ` stroke-linecap="${o.cap}"` : ""}/>`);
    },
    poly(points, o = {}) {
      parts.push(`<polygon points="${points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}"${attrs({ fill: COLORS.ink, ...o })}/>`);
    },
    // y is the vertical centre for va "middle", the top for "top" and the baseline for "base".
    text(x, y, value, o = {}) {
      const size = o.size ?? 8;
      const base = o.va === "top" ? y + size * 0.8 : o.va === "base" ? y : y + size * 0.34;
      parts.push(`<text x="${num(x)}" y="${num(base)}" font-family="${o.family || FONT}" font-size="${size}" fill="${o.fill || COLORS.ink}" text-anchor="${o.anchor || "start"}"${o.weight ? ` font-weight="${o.weight}"` : ""}${o.italic ? ` font-style="italic"` : ""}>${esc(value)}</text>`);
    },
    // One <text> per base at an explicit x, so rows stay aligned in any renderer or editor.
    chars(xs, y, seq, o = {}) {
      const size = o.size ?? 10;
      const glyphs = String(seq).split("").map((ch, index) => (ch === " " ? "" : `<text x="${num(xs[index])}" y="${num(y + size * 0.34)}">${esc(ch)}</text>`)).join("");
      parts.push(`<g font-family="${MONO}" font-size="${size}" fill="${o.fill || COLORS.ink}" text-anchor="middle"${o.weight ? ` font-weight="${o.weight}"` : ""}>${glyphs}</g>`);
    },
    build(height, responsive = false, title = "") {
      const size = responsive ? `width="100%" style="max-width:${width}px;height:auto"` : `width="${width}" height="${num(height)}"`;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${num(height)}" ${size} role="img"${title ? ` aria-label="${esc(title)}"` : ""}>${title ? `<title>${esc(title)}</title>` : ""}<rect width="${width}" height="${num(height)}" fill="#ffffff"/>${parts.join("")}</svg>`;
    },
  };
}

function niceStep(span, target = 7) {
  const raw = span / target;
  const base = 10 ** Math.floor(Math.log10(raw));
  const pick = [1, 2, 5, 10].find((m) => m * base >= raw) || 10;
  return pick * base;
}

// Window helpers --------------------------------------------------------------------------------
function guideSite(guide) {
  const start = finite(guide.ps) ? guide.ps : guide.str === "-" ? guide.cut - 6 : guide.cut - 17;
  return guide.str === "-"
    ? { pamStart: start, pamEnd: start + 3, protStart: start + 3, protEnd: start + 23 }
    : { protStart: start, protEnd: start + 20, pamStart: start + 20, pamEnd: start + 23 };
}

function findPrimerSites(result, genome) {
  const forward = result.ps?.[0]?.s?.toUpperCase();
  const reverse = result.ps?.[1]?.s?.toUpperCase();
  if (!forward || !reverse) return null;
  const fwStart = genome.indexOf(forward);
  const revStart = genome.indexOf(revcomp(reverse));
  if (fwStart < 0 || revStart < 0 || revStart + reverse.length <= fwStart) return null;
  return { fwStart, fwEnd: fwStart + forward.length, revStart, revEnd: revStart + reverse.length, forward, reverse };
}

function blockingMarks(result) {
  return (result.ss || []).filter((item) => finite(item.gp)).map((item) => {
    const change = item.oc && item.nc ? `${item.oc}>${item.nc}` : "";
    const where = item.lb && item.lb !== "noncoding" ? item.lb.replace(/^p\./, "") : "noncoding";
    const pam = item.pamBefore && item.pamAfter ? `, PAM ${item.pamBefore}>${item.pamAfter}` : "";
    return { gp: item.gp, gi: item.gi, text: `${where} ${change}${pam}`.trim() };
  });
}

// Shared drawing blocks -------------------------------------------------------------------------
const PL = 22;
const WIDTH = 760;
const PR = 22;

function makeScale(vmin, vmax) {
  const scale = (WIDTH - PL - PR) / Math.max(vmax - vmin, 1);
  return { scale, X: (value) => PL + (value - vmin) * scale };
}

// Greedy word wrap for notes that can exceed the figure width; returns the number of lines drawn.
function drawNote(c, x, y, value, o = {}) {
  const maxChars = o.maxChars ?? Math.floor((WIDTH - PR - x) / ((o.size ?? 8) * 0.6));
  const lines = []; let current = "";
  String(value).split(/\s+/).forEach((word) => {
    if (current && (current + " " + word).length > maxChars) { lines.push(current); current = word; } else current = current ? `${current} ${word}` : word;
  });
  if (current) lines.push(current);
  lines.forEach((line, index) => c.text(x, y + index * 11, line, { size: o.size ?? 8, fill: o.fill || COLORS.ink }));
  return lines.length;
}

// A white backing keeps the dashed connectors from running through the title text.
function rowTitle(c, y, value) {
  c.rect(PL - 2, y - 6, String(value).length * 5.1 + 4, 12, { fill: "#ffffff" });
  c.text(PL, y, value, { size: 9.5 });
}

// Gene track: exons (CDS tall and dark, UTR thin and outlined) joined by intron lines. `pieces`
// maps a reference interval to the view intervals it occupies (several or none around an insertion).
function drawGene(c, ctx, y, pieces, vmaxView) {
  const { gb, X, vmin } = ctx;
  const exons = (gb.exons || []).slice().sort((a, b) => a.start - b.start);
  const cds = gb.cdsSegments || [];
  const emit = (a, b, draw) => pieces(a, b).forEach(([pa, pb]) => {
    const lo = Math.max(pa, vmin); const hi = Math.min(pb, vmaxView);
    if (hi > lo) draw(X(lo), X(hi));
  });
  const mid = y;
  exons.forEach((exon, index) => {
    const next = exons[index + 1];
    if (next) emit(exon.end, next.start, (xa, xb) => c.line(xa, mid, xb, mid, { stroke: COLORS.utr, sw: 1 }));
  });
  if (exons.length) emit(0, exons[0].start, (xa, xb) => c.line(xa, mid, xb, mid, { stroke: COLORS.utr, sw: 1 }));
  exons.forEach((exon) => emit(exon.start, exon.end, (xa, xb) => c.rect(xa, mid - 3.5, xb - xa, 7, { fill: "#ffffff", stroke: COLORS.utr, sw: 0.8 })));
  cds.forEach(([start, end]) => emit(start, end, (xa, xb) => c.rect(xa, mid - 8, xb - xa, 16, { fill: COLORS.cds })));
}

// Guides: one legend line each, then one bar row each (protospacer, PAM, cut tick).
function drawGuides(c, ctx, y, anchorWord) {
  const { X, guides, anchor } = ctx;
  let cursor = y;
  guides.forEach((guide, index) => {
    const distance = finite(guide.cut) && finite(anchor) ? guide.cut - anchor : null;
    const where = distance === null || !anchorWord ? "" : `, cut ${Math.abs(distance)} bp ${distance < 0 ? "5\u2032" : "3\u2032"} of the ${anchorWord}`;
    const lines = drawNote(c, PL, cursor + 5, `gRNA${index + 1}  ${guide.sp} + ${guide.pm}  (${guide.str} strand, GC ${guide.gc}%${where})`, { fill: COLORS.guide });
    cursor += 3 + lines * 9;
  });
  cursor += 3;
  guides.forEach((guide, index) => {
    const site = guideSite(guide);
    const rowY = cursor + index * 13;
    c.rect(X(site.protStart), rowY, X(site.protEnd) - X(site.protStart), 9, { fill: COLORS.guide });
    c.rect(X(site.pamStart), rowY, X(site.pamEnd) - X(site.pamStart), 9, { fill: COLORS.pam });
    c.line(X(guide.cut), rowY - 2, X(guide.cut), rowY + 11, { stroke: "#000000", sw: 1 });
    const centre = (X(site.protStart) + X(site.protEnd)) / 2;
    if (X(site.protEnd) - X(site.protStart) >= 11) c.text(centre, rowY + 4.5, String(index + 1), { size: 7, fill: "#ffffff", anchor: "middle", weight: "bold" });
  });
  return cursor + guides.length * 13 + 4 - y;
}

function drawSwatches(c, items, x0, y, maxX) {
  let x = x0; let line = 0;
  items.forEach((item) => {
    const labelWidth = String(item.label).length * 4.6 + 22;
    if (x + labelWidth > maxX) { x = x0; line += 1; }
    c.rect(x, y + line * 12 - 4, 9, 9, { fill: item.color });
    c.text(x + 13, y + line * 12 + 0.5, item.label, { size: 8 });
    x += labelWidth + 8;
  });
  return (line + 1) * 12;
}

function drawMarker(c, x, y, color = COLORS.alarm) {
  c.poly([[x - 3.5, y - 7], [x + 3.5, y - 7], [x, y]], { fill: color });
}

function drawPcr(c, ctx, y, rows) {
  const { X } = ctx;
  let cursor = y;
  rows.forEach((row) => {
    c.line(X(row.a), cursor, X(row.b), cursor, { stroke: row.color, sw: 1.1 });
    const arm = 22 * ctx.scale;
    const stub = Math.max(arm, 7);
    c.line(X(row.a), cursor, X(row.a) + stub, cursor, { stroke: row.color, sw: 3.4 });
    c.poly([[X(row.a) + stub, cursor - 3], [X(row.a) + stub + 4.5, cursor], [X(row.a) + stub, cursor + 3]], { fill: row.color });
    c.line(X(row.b) - stub, cursor, X(row.b), cursor, { stroke: row.color, sw: 3.4 });
    c.poly([[X(row.b) - stub, cursor - 3], [X(row.b) - stub - 4.5, cursor], [X(row.b) - stub, cursor + 3]], { fill: row.color });
    c.text((X(row.a) + X(row.b)) / 2, cursor + 11, row.label, { size: 8, anchor: "middle", fill: row.color });
    cursor += 25;
  });
  return cursor - y;
}

function drawAxis(c, ctx, y, vmin, vmax, anchor, label) {
  const { X } = ctx;
  const step = niceStep(vmax - vmin);
  c.line(X(vmin), y, X(vmax), y, { stroke: COLORS.ink, sw: 0.8 });
  const first = Math.ceil((vmin - anchor) / step) * step;
  for (let t = first; anchor + t <= vmax; t += step) {
    c.line(X(anchor + t), y, X(anchor + t), y + 3.5, { stroke: COLORS.ink, sw: 0.8 });
    c.text(X(anchor + t), y + 13, minus(t), { size: 7.5, anchor: "middle" });
  }
  c.text((X(vmin) + X(vmax)) / 2, y + 27, label, { size: 8.5, anchor: "middle" });
  return 34;
}

function collectContext(result) {
  const gb = result.gb;
  const genome = String(gb.genomicSequence || "").toUpperCase();
  const guides = (result.gs || []).filter((guide) => finite(guide.cut));
  return { gb, genome, guides, marks: blockingMarks(result), primers: findPrimerSites(result, genome) };
}

// Tag insertion (C- or N-terminal): donor block with arms around a cassette ------------------------
function tagGeometry(result) {
  const isCt = result.type === "ct";
  const anchor = isCt ? result.sp - 1 : result.gb.cdsSegments?.[0]?.[0];
  const parts = (result.donorAnnotations || []).filter((item) => item.priority === 1);
  const insertParts = parts.filter((item) => !/^[35]['\u2032] HA$/.test(item.label));
  if (!finite(anchor) || !finite(result.h5l) || !finite(result.h3l) || !finite(result.il) || !insertParts.length) return null;
  return { anchor, h5: result.h5l, h3: result.h3l, il: result.il, shift: result.il - 3, insertParts, isCt };
}

function panelATag(c, ctx, geo, top) {
  const { result, genome, guides, marks, primers } = ctx;
  const { anchor, h5, h3, il, shift, isCt } = geo;
  const vmin = Math.max(0, Math.min(anchor - h5 - 25, ...guides.map((g) => guideSite(g).protStart - 12), primers ? primers.fwStart - 14 : Infinity));
  const vmaxRef = Math.min(genome.length, Math.max(anchor + 3 + h3 + 25, ...guides.map((g) => guideSite(g).pamEnd + 12), primers ? primers.revEnd + 14 : -Infinity));
  const vmaxEdit = vmaxRef + shift;
  const { scale, X } = makeScale(vmin, vmaxEdit);
  Object.assign(ctx, { X, scale, vmin, anchor });
  const word = isCt ? "insertion point" : "insertion point";
  let y = top;
  c.text(4, y + 4, "a", { size: 13, weight: "bold" });
  y += 6;
  y += drawGuides(c, ctx, y, word);
  rowTitle(c, y + 6, `Reference allele (${ctx.result.gene || "target"} ${isCt ? "3\u2032 end" : "5\u2032 end"})`);
  y += 28;
  const refMid = y;
  const refPieces = (a, b) => [[a, b]];
  drawGene(c, ctx, refMid, refPieces, vmaxRef);
  const codonLabel = isCt ? "stop" : "start";
  c.rect(X(anchor), refMid - 8, 3 * scale, 16, { fill: "#222222" });
  c.text(X(anchor) + 1.5 * scale, refMid - 13, codonLabel, { size: 8, anchor: "middle" });
  y += 50;
  const donorMid = y + 4;
  const arm = (a, b, label) => {
    c.rect(X(a), donorMid - 8, X(b) - X(a), 16, { fill: COLORS.arm });
    c.text((X(a) + X(b)) / 2, donorMid, label, { size: 8, anchor: "middle" });
  };
  [[anchor - h5, anchor], [anchor + 3, anchor + 3 + h3]].forEach(([a, b]) => c.line(X(a), refMid + 9, X(a === anchor + 3 ? anchor + il : a), donorMid - 9, { stroke: COLORS.connector, sw: 0.6, dash: "3 2" }));
  c.line(X(anchor), refMid + 9, X(anchor), donorMid - 9, { stroke: COLORS.connector, sw: 0.6, dash: "3 2" });
  c.line(X(anchor + 3 + h3), refMid + 9, X(anchor + il + h3), donorMid - 9, { stroke: COLORS.connector, sw: 0.6, dash: "3 2" });
  rowTitle(c, donorMid - 28, `Donor (${result.donorFormat?.short || "dsDNA"}), ${result.dl} bp: ${h5} | ${il} | ${h3}`);
  arm(anchor - h5, anchor, `5\u2032 arm ${h5} bp`);
  let cursor = anchor;
  geo.insertParts.forEach((part) => {
    const length = part.end - part.start;
    c.rect(X(cursor), donorMid - 10, length * scale, 20, { fill: part.color });
    cursor += length;
  });
  arm(anchor + il, anchor + il + h3, `3\u2032 arm ${h3} bp`);
  const donorMarks = marks.filter((mark) => mark.gp >= anchor - h5 && mark.gp < anchor + 3 + h3 && !(mark.gp >= anchor && mark.gp < anchor + 3));
  const markX = (gp) => X(gp < anchor ? gp : gp + shift);
  donorMarks.forEach((mark) => drawMarker(c, markX(mark.gp) + 0.5 * scale, donorMid - 10));
  y = donorMid + 20;
  const legend = geo.insertParts.map((part) => ({ label: part.label, color: part.color }));
  y += drawSwatches(c, legend, PL, y, WIDTH - PR);
  if (donorMarks.length) {
    drawMarker(c, PL + 4, y + 3);
    const noteLines = drawNote(c, PL + 12, y - 0.5, `Blocking change${donorMarks.length > 1 ? "s" : ""} in the arms: ${donorMarks.map((mark) => mark.text).join("; ")}`, { fill: COLORS.alarm });
    y += 3 + noteLines * 11;
  }
  y += 18;
  rowTitle(c, y, `Edited allele (coordinates 3\u2032 of the insertion shifted by +${shift} bp)`);
  y += 27;
  const editMid = y;
  const editPieces = (a, b) => {
    const out = [];
    if (a < anchor) out.push([a, Math.min(b, anchor)]);
    if (b > anchor + 3) out.push([Math.max(a, anchor + 3) + shift, b + shift]);
    return out;
  };
  drawGene(c, ctx, editMid, editPieces, vmaxEdit);
  cursor = anchor;
  geo.insertParts.forEach((part) => {
    const length = part.end - part.start;
    c.rect(X(cursor), editMid - 10, length * scale, 20, { fill: part.color });
    cursor += length;
  });
  donorMarks.forEach((mark) => drawMarker(c, markX(mark.gp) + 0.5 * scale, editMid - 10));
  c.rect(X(anchor - h5), editMid + 13, h5 * scale, 4, { fill: COLORS.arm });
  c.rect(X(anchor + il), editMid + 13, h3 * scale, 4, { fill: COLORS.arm });
  c.text(X(anchor - h5 / 2), editMid + 28, "donor-derived", { size: 7.5, anchor: "middle", fill: COLORS.muted });
  c.text(X(anchor + il + h3 / 2), editMid + 28, "donor-derived", { size: 7.5, anchor: "middle", fill: COLORS.muted });
  y = editMid + 42;
  if (primers && primers.fwStart < anchor && primers.revEnd > anchor + 3) {
    rowTitle(c, y, "Screening PCR (primers outside both arms)");
    y += 20;
    const wt = primers.revEnd - primers.fwStart;
    y += drawPcr(c, ctx, y, [
      { a: primers.fwStart, b: primers.revEnd, color: COLORS.pcrWt, label: `wild type, ${wt} bp (reference coordinates)` },
      { a: primers.fwStart, b: primers.revEnd + shift, color: COLORS.pcrEdit, label: `edited allele, ${wt + shift} bp` },
    ]);
    ctx.pcr = { wt, edited: wt + shift };
  }
  y += 6;
  y += drawAxis(c, ctx, y, vmin, vmaxEdit, anchor, `bp from the insertion point (first base of the replaced ${isCt ? "stop" : "start"} codon = 0 = position ${anchor + 1} of the uploaded reference)`);
  return y;
}

// ssODN designs: point mutation (pm) and internal tag (it) ----------------------------------------
function panelASsodn(c, ctx, top) {
  const { result, genome, guides, marks, primers } = ctx;
  const isIt = result.type === "it";
  const anchor = result.gp;
  const insertLength = isIt ? result.il : 0;
  const donors = (result.os || []).filter((donor) => finite(donor.donorStart) && finite(donor.donorEnd));
  if (!finite(anchor) || !donors.length) return null;
  const lows = [anchor - 20, ...donors.map((d) => d.donorStart - 10), ...guides.map((g) => guideSite(g).protStart - 10)];
  const highs = [anchor + 20, ...donors.map((d) => d.donorEnd + 10), ...guides.map((g) => guideSite(g).pamEnd + 10)];
  if (primers) { lows.push(primers.fwStart - 14); highs.push(primers.revEnd + 14); }
  const vmin = Math.max(0, Math.min(...lows));
  const vmaxRef = Math.min(genome.length, Math.max(...highs));
  const vmaxView = vmaxRef + insertLength;
  const { scale, X } = makeScale(vmin, vmaxView);
  Object.assign(ctx, { X, scale, vmin, anchor });
  const shiftX = (value) => (value < anchor ? value : value + insertLength);
  const pieces = insertLength
    ? (a, b) => { const out = []; if (a < anchor) out.push([a, Math.min(b, anchor)]); if (b > anchor) out.push([Math.max(a, anchor) + insertLength, b + insertLength]); return out; }
    : (a, b) => [[a, b]];
  let y = top;
  c.text(4, y + 4, "a", { size: 13, weight: "bold" });
  y += 6;
  y += drawGuides(c, ctx, y, isIt ? "insertion site" : "edited base");
  rowTitle(c, y + 6, `Reference allele (${result.gene || "target"})`);
  y += 28;
  const refMid = y;
  drawGene(c, ctx, refMid, (a, b) => [[a, b]], vmaxRef);
  const editLabel = isIt ? `insert ${result.il} bp${result.tag ? ` (${result.tag})` : ""}` : `${result.wA || ""}${result.an || ""}${result.mA || ""}${result.wC && result.mC ? ` ${result.wC}>${result.mC}` : ""}`.trim();
  c.line(X(anchor) + 0.5 * scale, refMid - 14, X(anchor) + 0.5 * scale, refMid + 14, { stroke: COLORS.alarm, sw: 1.6 });
  c.text(X(anchor) + 0.5 * scale, refMid - 20, editLabel, { size: 8.5, anchor: "middle", fill: COLORS.alarm, weight: "bold" });
  y += 40;
  donors.forEach((donor, index) => {
    const midY = y + 6;
    const left = donor.donorStart; const right = donor.donorEnd;
    c.line(X(left), refMid + 9, X(left), midY - 9, { stroke: COLORS.connector, sw: 0.5, dash: "3 2" });
    c.line(X(right), refMid + 9, X(right + insertLength), midY - 9, { stroke: COLORS.connector, sw: 0.5, dash: "3 2" });
    // A donor shows the blocking changes it actually carries. With co-delivery every ssODN carries
    // the changes for every guide, so the matched guide alone is not the whole story.
    const matchedGuide = (donor.gi ?? index) + 1;
    const ownPositions = Array.isArray(donor.silentMutations) ? new Set(donor.silentMutations.map((item) => item.gp)) : null;
    const carried = marks.filter((mark) => mark.gp >= left && mark.gp < right && mark.gp !== anchor
      && (ownPositions ? ownPositions.has(mark.gp) : mark.gi === matchedGuide));
    const carriedGuides = [...new Set(carried.map((mark) => mark.gi))].sort((a, b) => a - b);
    const otherGuides = carriedGuides.filter((guide) => guide !== matchedGuide);
    const alsoBlocks = otherGuides.length ? `; also blocks ${otherGuides.map((guide) => `gRNA${guide}`).join(" + ")}` : "";
    rowTitle(c, midY - 20, `${String(donor.n || `ssODN ${index + 1}`).replace(/\s*\(matched to .*\)/, "")} (matched to gRNA${matchedGuide}${alsoBlocks}), ${isIt ? (right - left) + insertLength : right - left} nt`);
    c.rect(X(left), midY - 7, X(Math.min(anchor, right)) - X(left), 14, { fill: COLORS.arm });
    if (isIt) {
      c.rect(X(anchor), midY - 9, insertLength * scale, 18, { fill: "#33a02c" });
      c.rect(X(anchor) + insertLength * scale, midY - 7, X(right) - X(anchor), 14, { fill: COLORS.arm });
    } else {
      c.rect(X(anchor) , midY - 9, Math.max(scale, 2.2), 18, { fill: COLORS.alarm });
      c.rect(X(anchor) + Math.max(scale, 2.2), midY - 7, Math.max(X(right) - X(anchor) - Math.max(scale, 2.2), 0), 14, { fill: COLORS.arm });
    }
    carried.forEach((mark) => drawMarker(c, X(shiftX(mark.gp)) + 0.5 * scale, midY - 9));
    y += 34;
  });
  const markList = marks.map((mark) => `gRNA${mark.gi}: ${mark.text}`);
  if (markList.length) {
    drawMarker(c, PL + 4, y + 3);
    const noteLines = drawNote(c, PL + 12, y - 0.5, `Blocking changes: ${markList.join("; ")}`, { fill: COLORS.alarm });
    y += 3 + noteLines * 11;
  }
  y += 10;
  if (primers && primers.fwStart < anchor && primers.revEnd > anchor) {
    rowTitle(c, y, "Screening PCR");
    y += 20;
    const wt = primers.revEnd - primers.fwStart;
    y += drawPcr(c, ctx, y, [{ a: primers.fwStart, b: primers.revEnd + insertLength, color: COLORS.pcrWt, label: isIt ? `wild type ${wt} bp; edited allele ${wt + insertLength} bp` : `amplicon, ${wt} bp (sequence the edit site)` }]);
  }
  y += 6;
  y += drawAxis(c, ctx, y, vmin, vmaxView, anchor, `bp from the ${isIt ? "insertion site" : "edited base"} (reference coordinates; ${isIt ? `insertion between positions ${anchor} and ${anchor + 1}` : `edited base = position ${anchor + 1}`} of the uploaded reference)`);
  return y;
}

// Knockout (two-guide deletion) ------------------------------------------------------------------
function panelAKo(c, ctx, top) {
  const { result, genome, guides, primers } = ctx;
  if (!guides.length) return null;
  const cuts = guides.map((guide) => guide.cut);
  const delLo = Math.min(...cuts); const delHi = Math.max(...cuts);
  const lows = [...guides.map((g) => guideSite(g).protStart - 12), delLo - 20];
  const highs = [...guides.map((g) => guideSite(g).pamEnd + 12), delHi + 20];
  if (primers) { lows.push(primers.fwStart - 14); highs.push(primers.revEnd + 14); }
  const vmin = Math.max(0, Math.min(...lows)); const vmax = Math.min(genome.length, Math.max(...highs));
  const { scale, X } = makeScale(vmin, vmax);
  Object.assign(ctx, { X, scale, vmin, anchor: delLo });
  let y = top;
  c.text(4, y + 4, "a", { size: 13, weight: "bold" });
  y += 6;
  y += drawGuides(c, ctx, y, "");
  rowTitle(c, y + 6, `Reference allele (${result.gene || "target"})`);
  y += 28;
  const refMid = y;
  drawGene(c, ctx, refMid, (a, b) => [[a, b]], vmax);
  y += 34;
  if (delHi > delLo) {
    c.rect(X(delLo), y - 5, X(delHi) - X(delLo), 10, { fill: "#fbe3d3", stroke: COLORS.alarm, sw: 1 });
    c.text((X(delLo) + X(delHi)) / 2, y + 17, `deletion between the cuts, ${delHi - delLo} bp${result.deletionOutcome?.frameshiftPredicted ? " (frameshift predicted)" : ""}`, { size: 8.5, anchor: "middle", fill: COLORS.alarm });
    y += 34;
  }
  if (primers && primers.fwStart < delLo && primers.revEnd > delHi) {
    rowTitle(c, y, "Screening PCR");
    y += 20;
    const wt = primers.revEnd - primers.fwStart;
    y += drawPcr(c, ctx, y, [
      { a: primers.fwStart, b: primers.revEnd, color: COLORS.pcrWt, label: `wild type, ${wt} bp` },
      { a: primers.fwStart, b: primers.revEnd - (delHi - delLo), color: COLORS.pcrEdit, label: `deletion allele, ${wt - (delHi - delLo)} bp` },
    ]);
  }
  y += 6;
  y += drawAxis(c, ctx, y, vmin, vmax, delLo, `bp from the left-most cut (reference coordinates; cut between positions ${delLo} and ${delLo + 1} of the uploaded reference)`);
  return y;
}

// Panel b: sequence and reading frame at the insertion site ----------------------------------------
const STEP = 7.6;
const CODON_GAP = 3.4;

function layoutSegments(segments, startX) {
  const cells = []; const aas = []; let x = startX;
  segments.forEach((segment) => {
    if (segment.gap) { segment.gapX = x + segment.gap / 2; x += segment.gap; return; }
    for (let i = 0; i < segment.seq.length; i += 1) {
      if (segment.frame && i > 0 && i % 3 === 0) x += CODON_GAP;
      cells.push({ ch: segment.seq[i], x: x + STEP / 2, g: finite(segment.gStart) ? segment.gStart + i : null, bg: segment.bg?.[i], dim: !segment.frame });
      if (segment.frame && i % 3 === 2) aas.push({ aa: aaOf(segment.seq.slice(i - 2, i + 1)), x: cells[cells.length - 2].x });
      x += STEP;
    }
    x += 8;
  });
  return { cells, aas, end: x };
}

function drawSequenceRow(c, layout, y, hits = new Set(), segments = []) {
  layout.cells.forEach((cell, index) => { if (cell.bg) c.rect(cell.x - STEP / 2 - 0.3, y - 7, STEP + 0.6, 14, { fill: cell.bg, op: 0.45 }); if (hits.has(index)) c.rect(cell.x - STEP / 2 - 0.3, y - 7, STEP + 0.6, 14, { fill: "#fbd3b8" }); });
  const plain = layout.cells.filter((_, index) => !hits.has(index));
  c.chars(plain.map((cell) => cell.x), y, plain.map((cell) => cell.ch).join(""), { size: 10.5 });
  layout.cells.forEach((cell, index) => { if (hits.has(index)) c.chars([cell.x], y, cell.ch, { size: 10.5, fill: COLORS.alarm, weight: "bold" }); });
  segments.forEach((segment) => { if (segment.gap) c.text(segment.gapX, y, `\u2026 ${segment.label} \u2026`, { size: 8.5, anchor: "middle", fill: COLORS.muted }); });
}

function panelBTag(c, ctx, geo, top) {
  const { result, genome, guides } = ctx;
  const donor = String(result.donor || "").toUpperCase();
  const { anchor, h5, h3, il, isCt } = geo;
  if (!donor || donor.length < h5 + il + 12) return top;
  const leftLen = isCt ? 24 : 12; const rightLen = isCt ? 12 : 24;
  const tint = (donorIndex) => {
    const part = geo.insertParts.find((item) => donorIndex >= item.start && donorIndex < item.end);
    return part ? part.color : undefined;
  };
  const wtSegments = isCt
    ? [{ seq: genome.slice(anchor - leftLen, anchor), frame: true, gStart: anchor - leftLen }, { seq: genome.slice(anchor, anchor + 3), frame: true, gStart: anchor }, { seq: genome.slice(anchor + 3, anchor + 3 + rightLen), frame: false, gStart: anchor + 3 }]
    : [{ seq: genome.slice(anchor - leftLen, anchor), frame: false, gStart: anchor - leftLen }, { seq: genome.slice(anchor, anchor + 3 + rightLen), frame: true, gStart: anchor }];
  const edge = Math.min(12, Math.floor(il / 2));
  const long = il > 2 * edge + 6;
  const cassette = donor.slice(h5, h5 + il);
  const colors = (from, to) => Array.from({ length: to - from }, (_, i) => tint(h5 + from + i));
  const editLeft = donor.slice(h5 - leftLen, h5); const editRight = donor.slice(h5 + il, h5 + il + rightLen);
  const editSegments = [];
  if (isCt) editSegments.push({ seq: editLeft, frame: true, key: "left", wtSeq: genome.slice(anchor - leftLen, anchor) });
  else editSegments.push({ seq: editLeft, frame: false, key: "left", wtSeq: genome.slice(anchor - leftLen, anchor) });
  if (long) {
    editSegments.push({ seq: cassette.slice(0, edge), frame: true, bg: colors(0, edge) });
    editSegments.push({ gap: 74, label: `${il - 2 * edge} bp` });
    editSegments.push({ seq: cassette.slice(il - edge), frame: true, bg: colors(il - edge, il) });
  } else editSegments.push({ seq: cassette, frame: true, bg: colors(0, il) });
  editSegments.push({ seq: editRight, frame: !isCt, key: "right", wtSeq: isCt ? genome.slice(anchor + 3, anchor + 3 + rightLen) : genome.slice(anchor + 3, anchor + 3 + rightLen) });
  const labelX = PL; const startX = PL + 74;
  let y = top;
  c.text(4, y + 4, "b", { size: 13, weight: "bold" });
  y += 8;
  rowTitle(c, y + 6, `Sequence at the insertion site (${isCt ? "stop codon replaced by the cassette" : "start codon becomes the first codon of the cassette"})`);
  y += 28;
  const wt = layoutSegments(wtSegments, startX);
  wt.aas.forEach((item) => c.text(item.x, y, item.aa, { size: 8.5, anchor: "middle", fill: COLORS.cds }));
  c.text(labelX, y + 16, "Reference", { size: 9, weight: "bold" });
  drawSequenceRow(c, wt, y + 16);
  const byG = new Map(wt.cells.filter((cell) => cell.g !== null).map((cell) => [cell.g, cell]));
  guides.forEach((guide, index) => {
    const site = guideSite(guide);
    const rowY = y + 31 + index * 11;
    const span = (from, to, color) => {
      const cellsIn = []; for (let g = from; g < to; g += 1) if (byG.has(g)) cellsIn.push(byG.get(g));
      if (cellsIn.length) c.rect(cellsIn[0].x - STEP / 2, rowY, cellsIn[cellsIn.length - 1].x - cellsIn[0].x + STEP, 6, { fill: color });
    };
    span(site.protStart, site.protEnd, COLORS.guide); span(site.pamStart, site.pamEnd, COLORS.pam);
    const left = byG.get(guide.cut - 1); const right = byG.get(guide.cut);
    if (left && right) c.line((left.x + right.x) / 2, y + 7, (left.x + right.x) / 2, rowY + 8, { stroke: "#000000", sw: 1 });
    c.text(startX - 6, rowY + 3, `gRNA${index + 1}`, { size: 7.5, anchor: "end", fill: COLORS.guide });
  });
  y += 31 + guides.length * 11 + 14;
  c.text(labelX, y, "Edited", { size: 9, weight: "bold" });
  const ed = layoutSegments(editSegments, startX);
  const hits = new Set();
  let cursor = 0;
  editSegments.forEach((segment) => {
    if (segment.gap) return;
    if (segment.wtSeq) for (let i = 0; i < segment.seq.length; i += 1) if (segment.seq[i] !== segment.wtSeq[i]) hits.add(cursor + i);
    cursor += segment.seq.length;
  });
  drawSequenceRow(c, ed, y, hits, editSegments);
  ed.aas.forEach((item) => c.text(item.x, y + 15, item.aa, { size: 8.5, anchor: "middle", fill: COLORS.cds }));
  y += 28;
  if (hits.size) {
    drawMarker(c, startX + 4, y + 4);
    c.text(startX + 12, y + 0.5, `${hits.size} base${hits.size > 1 ? "s differ" : " differs"} from the reference within the region shown (blocking change${hits.size > 1 ? "s" : ""}; shaded)`, { size: 8, fill: COLORS.alarm });
    y += 14;
  }
  return y + 4;
}

// Panel c: tagged protein --------------------------------------------------------------------------
function panelCTag(c, ctx, geo, top) {
  const { result } = ctx;
  const native = result.prot;
  if (!finite(native)) return top;
  const parts = geo.insertParts.filter((part) => !/^(start|stop)$/i.test(part.label)).map((part) => ({ label: part.label, color: part.color, aa: Math.round((part.end - part.start) / 3) }));
  const tagAa = parts.reduce((sum, part) => sum + part.aa, 0);
  const total = native + tagAa;
  const left = PL + 74; const usable = WIDTH - PR - left;
  const scale = usable / total;
  let y = top;
  c.text(4, y + 4, "c", { size: 13, weight: "bold" });
  y += 8;
  rowTitle(c, y + 6, `Tagged protein: ${native} aa native + ${tagAa} aa tag = ${total} aa`);
  y += 24;
  let x = left;
  const nativeBar = (width, label) => { c.rect(x, y - 8, width, 16, { fill: COLORS.native }); c.text(x + width / 2, y, label, { size: 8, anchor: "middle", fill: "#ffffff" }); x += width; };
  if (!geo.isCt) parts.forEach((part) => { c.rect(x, y - 8, part.aa * scale, 16, { fill: part.color }); x += part.aa * scale; });
  nativeBar(native * scale, `native ${result.gene || "protein"}, ${native} aa`);
  if (geo.isCt) parts.forEach((part) => { c.rect(x, y - 8, part.aa * scale, 16, { fill: part.color }); x += part.aa * scale; });
  c.text(PL, y, "N \u2192 C", { size: 9, weight: "bold" });
  y += 20;
  y += drawSwatches(c, parts.map((part) => ({ label: `${part.label} (${part.aa} aa)`, color: part.color })).concat([{ label: `native (${native} aa)`, color: COLORS.native }]), left, y, WIDTH - PR);
  return y + 4;
}

// Entry points ---------------------------------------------------------------------------------------
const TYPE_LABEL = {
  ct: "C-terminal tag knock-in", nt: "N-terminal tag knock-in", pm: "point-mutation knock-in",
  it: "internal tag knock-in", ko: "knockout (two-guide deletion)",
};
const TAG_TYPES = ["ct", "nt"];

// Genomic SNP references: a reverse-strand gene's record is written along the transcript (Location ...:-1), so index i is coordinate referenceEnd - i.
// Kept local because this module has no imports; the same mapping lives in genomicCoords.js.
const isReverseRecord = (input) => Number(input?.orientation) === -1;
const genomicAt = (input, index) => (isReverseRecord(input) ? Number(input.referenceEnd) - index : Number(input.referenceStart) + index);
const indexOfGenomic = (input, position) => (isReverseRecord(input) ? Number(input.referenceEnd) - position : position - Number(input.referenceStart));
const firstTickIndex = (input, from, step) => (isReverseRecord(input) ? from + ((((Number(input.referenceEnd) - from) % step) + step) % step) : Math.ceil((from + Number(input.referenceStart)) / step) * step - Number(input.referenceStart));

// Genomic substitutions use real genomic coordinates and nucleotide checks, never a protein-edit surrogate.
function genomicScheme(result, options = {}) {
  const {input, candidates, gb} = result;
  const genome = gb.genomicSequence;
  const edit = indexOfGenomic(input, input.position);
  const reverse = isReverseRecord(input);
  const guides = candidates.filter(g => finite(g.cut));
  const c = createCanvas(1100);
  const left = 160, right = 790;
  const palette = ['#009E73','#767f89','#CC79A7','#0072B2'];
  const lo = Math.max(0,Math.min(edit-22,...guides.map(g=>g.ps))-3);
  const hi = Math.min(genome.length,Math.max(edit+20,...guides.map(g=>g.ps+23))+3);
  const X = p => left + (p-lo)/(hi-lo)*(right-left);
  const gx = p => fmtBp(genomicAt(input,p));
  const title = `${input.gene || 'Locus'} — ${input.assembly} chr${String(input.chromosome).replace(/^chr/i,'')}:${input.position} ${input.ref}>${input.alt}${reverse ? ' (reverse-strand gene, drawn along the transcript)' : ''}`;
  c.text(20,22,title,{size:18,weight:'bold'});
  c.text(20,49,`${result.status} — alternative guide/donor pairs; use separately`,{size:13,fill:COLORS.alarm});
  c.text(20,80,'a  Target sequence, exon boundary, guides and PAMs',{size:16,weight:'bold'});
  const boundary=result.context?.nearestExonBoundary;
  if(boundary)c.text(160,101,`${boundary.label}, ${boundary.edge}: edit offset ${boundary.distance>0?'+':''}${boundary.distance} bp`,{size:11,fill:COLORS.muted});
  const geneTrack = (scale, lower, upper, y) => {
    c.line(scale(lower),y,scale(upper),y,{stroke:'#5b6770',sw:2});
    (gb.exons || []).filter(e=>e.end>lower && e.start<upper).forEach(e=>{
      const a=Math.max(lower,e.start), b=Math.min(upper,e.end);
      c.rect(scale(a),y-10,scale(b)-scale(a),20,{fill:'#8fa3b8'});
      if(scale(b)-scale(a)>70)c.text(scale(a)+4,y,e.label || `Exon ${e.exonNumber || ''}`,{size:11,fill:'#fff'});
      for(const edge of [e.start,e.end])if(edge>lower && edge<upper)c.line(scale(edge),y-18,scale(edge),y+18,{stroke:'#5b6770',dash:'3 3'});
    });
  };
  geneTrack(X,lo,hi,125);
  c.text(810,120,'Exons shaded; introns shown as lines',{size:10,fill:COLORS.muted});
  for(let p=firstTickIndex(input,lo,10);p<hi;p+=10){c.text(X(p+.5),155,gx(p),{size:10,anchor:'middle',fill:COLORS.muted});c.line(X(p+.5),163,X(p+.5),170,{stroke:COLORS.muted});}
  const cell=(right-left)/(hi-lo);
  for(let p=lo;p<hi;p++)c.text(X(p+.5),190,genome[p],{size:Math.min(12,cell*.85),family:MONO,anchor:'middle'});
  c.rect(X(edit),175,cell,29,{stroke:COLORS.alarm,sw:2});
  c.text(X(edit+.5),222,reverse ? revcomp(input.alt) : input.alt,{size:13,weight:'bold',anchor:'middle',fill:COLORS.alarm});
  let y=262;
  guides.forEach((g,i)=>{
    const color=palette[i%palette.length],site=guideSite(g);
    c.text(20,y,g.name,{size:13,weight:'bold',fill:color});
    c.rect(X(site.protStart),y-8,X(site.protEnd)-X(site.protStart),16,{fill:color});
    c.rect(X(site.pamStart),y-8,X(site.pamEnd)-X(site.pamStart),16,{fill:COLORS.ink});
    c.line(X(g.cut),y-16,X(g.cut),y+16,{sw:2});
    const pamGenome=g.donor.genomicDonor.slice(site.pamStart-g.donor.donorStart,site.pamEnd-g.donor.donorStart);
    const editedPam=g.str==='-' ? revcomp(pamGenome) : pamGenome;
    c.text(810,y-6,`PAM ${g.pam} → ${editedPam}; ${g.str} strand`,{size:11});
    c.text(810,y+10,`${g.protection.tier}; CFD ${finite(g.protection.cfd)?g.protection.cfd.toFixed(4):'unscored'}; cut ${g.d>0?'+':''}${g.d} bp`,{size:10,fill:COLORS.muted});
    y+=44;
  });
  c.text(20,y+2,'Orange: requested edit     Black: PAM / cut tick     CFD: predicted residual activity against the edited allele',{size:11,fill:COLORS.muted});
  y+=54;
  c.text(20,y,reverse ? 'b  Matched ssODNs — transcript-strand view' : 'b  Matched ssODNs — forward genomic view',{size:16,weight:'bold'});
  const dLo=Math.max(0,Math.min(edit-10,...guides.map(g=>g.donor.donorStart))-3);
  const dHi=Math.min(genome.length,Math.max(edit+10,...guides.map(g=>g.donor.donorEnd))+3);
  const D=p=>left+(p-dLo)/(dHi-dLo)*(right-left);
  geneTrack(D,dLo,dHi,y+38);
  y+=90;
  guides.forEach((g,i)=>{
    const d=g.donor,color=palette[i%palette.length];
    c.text(20,y,g.name+' donor',{size:12,weight:'bold',fill:color});
    c.rect(D(d.donorStart),y-10,D(d.donorEnd)-D(d.donorStart),20,{fill:color,op:.25,stroke:color,sw:2});
    c.line(D(edit+.5),y-15,D(edit+.5),y+15,{stroke:COLORS.alarm,sw:3});
    c.line(D(g.cut),y-18,D(g.cut),y+18,{sw:2});
    const extras=[...d.genomicDonor].flatMap((base,j)=>base!==genome[d.donorStart+j] && d.donorStart+j!==edit ? [d.donorStart+j] : []);
    extras.forEach(p=>c.line(D(p+.5),y-15,D(p+.5),y+15,{stroke:'#0072B2',sw:3}));
    c.text((D(d.donorStart)+D(g.cut))/2,y-24,`${g.cut-d.donorStart} nt`,{size:11,anchor:'middle'});
    c.text((D(g.cut)+D(d.donorEnd))/2,y-24,`${d.donorEnd-g.cut} nt`,{size:11,anchor:'middle'});
    c.text(810,y-5,`${d.od.length} nt; supplied ${g.str==='+'?'-':'+'} strand`,{size:11});
    c.text(810,y+12,extras.length?`${extras.length} additional changes (blue)`:'Requested edit only; no blocking changes',{size:10,fill:COLORS.muted});
    y+=70;
  });
  c.line(left,y-20,right,y-20,{sw:1});
  const step=niceStep(dHi-dLo,5);
  for(let p=firstTickIndex(input,dLo,step);p<dHi;p+=step){c.line(D(p),y-20,D(p),y-15);c.text(D(p),y,gx(p),{size:10,anchor:'middle'});}
  c.text((left+right)/2,y+25,`${input.assembly} chr${String(input.chromosome).replace(/^chr/i,'')} — 1-based genomic coordinates, forward strand${reverse ? '; the sequence is drawn along the transcript, so coordinates fall left to right' : ''}`,{size:12,anchor:'middle'});
  c.text(20,y+53,'Arms are measured from the cut. Splicing outcomes and genome-wide specificity are not validated.',{size:12,fill:COLORS.muted});
  return c.build(y+75,options.responsive,title);
}

export function supportsDesignScheme(result) {
  if (result?.type === 'genomic-snv') return Boolean(!result.err && result.gb?.genomicSequence && result.input && result.candidates?.some(g=>finite(g.cut)));
  return Boolean(result && !result.err && TYPE_LABEL[result.type] && result.gb && String(result.gb.genomicSequence || "").length
    && Array.isArray(result.gs) && result.gs.some((guide) => finite(guide.cut)));
}

function schemeTitle(result) {
  const geneName = result.gene || "target";
  const tagName = result.tag && result.type !== "pm" && result.type !== "ko" ? `, ${result.tag}` : "";
  return `${geneName}: ${TYPE_LABEL[result.type]}${tagName}`;
}

export function buildDesignSchemeSvg(result, options = {}) {
  if (!supportsDesignScheme(result)) return "";
  try {
    if (result.type === 'genomic-snv') return genomicScheme(result,options);
    const ctx = { result, ...collectContext(result) };
    const canvas = createCanvas(WIDTH);
    const title = schemeTitle(result);
    canvas.text(PL, 12, title, { size: 12, weight: "bold" });
    let y;
    const divider = (at) => canvas.line(PL, at, WIDTH - PR, at, { stroke: "#d0d5dd", sw: 0.8 });
    if (TAG_TYPES.includes(result.type)) {
      const geo = tagGeometry(result);
      if (!geo) return "";
      y = panelATag(canvas, ctx, geo, 28);
      divider(y + 6); y = panelBTag(canvas, ctx, geo, y + 14);
      divider(y + 6); y = panelCTag(canvas, ctx, geo, y + 14);
    } else if (result.type === "ko") {
      y = panelAKo(canvas, ctx, 28);
    } else {
      y = panelASsodn(canvas, ctx, 28);
    }
    if (y === null || y === undefined || !finite(y)) return "";
    return canvas.build(y + 8, options.responsive, title);
  } catch (error) {
    return "";
  }
}

export function buildDesignSchemeFilename(result) {
  const token = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (result?.type === 'genomic-snv') return `${token(result.input.gene) || 'locus'}_${result.input.position}_${result.input.ref}-${result.input.alt}_design_scheme.svg`;
  return `${token(result?.gene) || "design"}_${token(result?.type) || "scheme"}_design_scheme.svg`;
}

const list = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// Draft figure legend assembled from the design. Bracketed text is for the author to complete.
export function buildDesignSchemeCaption(result) {
  if (!supportsDesignScheme(result)) return "";
  if (result.type === 'genomic-snv') return `Genomic substitution at ${result.input.assembly} chr${result.input.chromosome}:${result.input.position} ${result.input.ref}>${result.input.alt}. Panel a shows the reference sequence, annotated exon boundaries, alternative guides, PAMs and cuts. PAMs and residual CFD refer to each matched edited allele. Panel b shows each donor in forward genomic orientation; supplied strand is labelled separately. Only changes present in the computed donors are drawn. Splicing outcomes and genome-wide specificity remain unvalidated. Status: ${result.status}.`;
  const guides = (result.gs || []).filter((guide) => finite(guide.cut));
  const guideText = guides.map((guide, index) => `gRNA${index + 1} (${guide.sp}, ${guide.pm} PAM, ${guide.str} strand, GC ${guide.gc}%)`);
  const primers = findPrimerSites(result, String(result.gb.genomicSequence).toUpperCase());
  const marks = blockingMarks(result);
  const blocking = marks.length ? ` Blocking changes in the donor (${list([...new Set(marks.map((mark) => mark.text))])}) prevent re-cutting of the edited allele.` : "";
  const gene = result.gene || "the target gene";
  const sentences = [];
  if (TAG_TYPES.includes(result.type)) {
    const geo = tagGeometry(result);
    if (!geo) return "";
    const cut = guides[0].cut - geo.anchor;
    const insert = geo.insertParts.filter((part) => !/^(start|stop)$/i.test(part.label)).map((part) => part.label);
    const aa = geo.insertParts.filter((part) => !/^(start|stop)$/i.test(part.label)).reduce((sum, part) => sum + Math.round((part.end - part.start) / 3), 0);
    sentences.push(`Design scheme for ${geo.isCt ? "C-terminal" : "N-terminal"} tagging of ${gene} (${result.tag || "tag"}) in [cell line].`);
    sentences.push(`(a) Strategy. ${list(guideText)} ${guides.length > 1 ? "cut" : "cuts"} ${guides.length > 1 ? "near" : `${Math.abs(cut)} bp ${cut < 0 ? "5\u2032" : "3\u2032"} of`} the ${geo.isCt ? "stop" : "start"} codon. The ${result.dl}-${result.donorFormat?.format === "ssodn" ? "nt ssODN" : "bp dsDNA"} donor carries a ${geo.h5}-${result.donorFormat?.format === "ssodn" ? "nt" : "bp"} 5\u2032 and a ${geo.h3}-${result.donorFormat?.format === "ssodn" ? "nt" : "bp"} 3\u2032 homology arm flanking ${list(insert)} (${geo.il} bp, ${aa} aa added), which replaces the ${geo.isCt ? "stop" : "start"} codon.${blocking}`);
    if (primers && primers.fwStart < geo.anchor && primers.revEnd > geo.anchor + 3) {
      const wt = primers.revEnd - primers.fwStart;
      sentences.push(`Screening primers outside both arms amplify ${wt} bp from the wild-type and ${wt + geo.shift} bp from the edited allele.`);
    }
    sentences.push(`(b) Sequence at the insertion site, with the reading frame, gRNA protospacer (purple), PAM (yellow) and cut site; changed bases are shaded. (c) Layout of the tagged protein (${result.prot} aa native + ${aa} aa tag). Scale bars: [add].`);
  } else if (result.type === "ko") {
    const cuts = guides.map((guide) => guide.cut);
    sentences.push(`Design scheme for knockout of ${gene} in [cell line].`);
    sentences.push(`${list(guideText)} cut ${Math.max(...cuts) - Math.min(...cuts)} bp apart${result.exon ? ` within ${result.exon}` : ""}; the deletion between the cuts is screened by PCR${primers ? ` (${primers.revEnd - primers.fwStart} bp wild-type amplicon)` : ""}.`);
  } else {
    const donors = (result.os || []);
    const lengths = donors.map((donor) => `${donor.donorEnd - donor.donorStart}`);
    const what = result.type === "it" ? `internal tag (${result.tag || "tag"}, ${result.il} bp)` : `point mutation ${result.wA || ""}${result.an || ""}${result.mA || ""}`;
    sentences.push(`Design scheme for ${what} knock-in at ${gene} in [cell line].`);
    sentences.push(`${list(guideText)}; ${donors.length} ssODN donor${donors.length === 1 ? "" : "s"} (${list(lengths)} nt${result.type === "it" ? " of genomic sequence plus the insert" : ""}).${blocking}${primers ? ` Screening PCR amplicon: ${primers.revEnd - primers.fwStart} bp.` : ""}`);
  }
  return sentences.join(" ");
}
