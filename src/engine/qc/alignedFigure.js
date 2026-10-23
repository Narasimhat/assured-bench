// Figures that lay the clones onto the control: one clone against the wild-type control (annotated chromatograms), all clones stacked on the same
// stretch, and the base calls of all clones as an alignment. They draw the view of src/alignedView.js: guides with their PAM and cut, the designed
// changes, both chromatograms base by base, and every base that differs from the control. Vector SVG with real text, 1 unit = 1 pixel at 96 dpi;
// no scripts and no external resources.
import { summaryOrder } from "./summaryFigure.js";
import { aaOf } from "./protein.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const INK = "#101828"; const MUTED = "#475467"; const CUT = "#d92d20";
const CHANNEL = { A: "#1a9850", C: "#2166ac", G: "#222222", T: "#d73027" };
const DECISION = { accept: ["A", "#d1fadf", "#12b76a"], hold: ["H", "#fef0c7", "#f79009"], "re-sequence": ["S", "#d1e9ff", "#2e90fa"], reject: ["R", "#fee4e2", "#f04438"] };
const DECISION_LABEL = { accept: "Accept", hold: "Hold", "re-sequence": "Sequence again", reject: "Reject" };
const MARKER_COLOR = (role) => (/block/i.test(role) ? "#e08214" : "#7b3294");
const fmt = (x) => x.toFixed(1);

function frame(view, { width, ml, mr }) {
  const w = width - ml - mr; const step = w / view.length;
  return { n: view.length, step, ml, w, x: (i) => ml + (i + 0.5) * step, xl: (i) => ml + i * step };
}

/** Marker labels and guide bars above the strips. @returns {{ svg: string, height: number }} */
function annotation(view, F, y0) {
  let svg = ""; const rows = []; const sorted = [...view.markers].sort((a, b) => a.at - b.at);
  sorted.forEach((m) => {
    const text = m.protein ? `${m.protein.label}${m.protein.silent ? " silent" : ""} ${m.protein.codonFrom}>${m.protein.codonTo}` : `${m.label ? `${m.label} ` : ""}${m.change}`; const half = (text.length * 4.4) / 2; const x0 = F.x(m.at) - half; const x1 = F.x(m.at) + half;
    let r = 0; while (rows[r] !== undefined && rows[r] > x0 - 4) r += 1; rows[r] = x1;
    svg += `<text x="${fmt(F.x(m.at))}" y="${y0 + 9 + r * 10}" text-anchor="middle" font-size="8" font-weight="700" fill="${MARKER_COLOR(m.role)}">${esc(text)}</text>`;
  });
  const markerH = Math.max(1, rows.length) * 10 + 2; let y = y0 + markerH;
  view.guides.forEach((g) => {
    if (g.spacer && g.pam) {
      const a = g.spacer[0]; const b = g.spacer[1]; const p0 = g.pam[0]; const p1 = g.pam[1]; const right = g.strand !== "-";
      svg += `<rect x="${fmt(F.xl(a))}" y="${y + 2}" width="${fmt(F.xl(b + 1) - F.xl(a))}" height="6" fill="#cfd4dc"/><rect x="${fmt(F.xl(p0))}" y="${y + 2}" width="${fmt(F.xl(p1 + 1) - F.xl(p0))}" height="6" fill="#98a2b3"/>`;
      const tip = right ? F.xl(p1 + 1) : F.xl(p0); const dir = right ? 1 : -1;
      svg += `<path d="M${fmt(tip)},${y + 5} l${-5 * dir},-4 l0,8 z" fill="#667085"/>`;
      const label = `${esc(String(g.name).split("_").pop())} (${g.strand === "-" ? "\u2212" : "+"})`;
      svg += right ? `<text x="${fmt(F.xl(p1 + 1) + 8)}" y="${y + 8.5}" font-size="8" fill="${MUTED}">${label}</text>` : `<text x="${fmt(F.xl(p0) - 8)}" y="${y + 8.5}" text-anchor="end" font-size="8" fill="${MUTED}">${label}</text>`;
    }
    y += 12;
  });
  if (view.protein) { svg += aaTrack(view, F, y); y += 14; }
  return { svg, height: y - y0 + 4 };
}

const COMPL = { A: "T", C: "G", G: "C", T: "A", N: "N" };

/** The control read translated in the design's reading frame: one box per codon, the designed codons coloured and numbered. */
function aaTrack(view, F, y) {
  const p = view.protein; if (!p || !p.codons.length) return "";
  const designed = new Map(); view.markers.forEach((m) => { if (m.protein) designed.set(m.protein.residue, m); });
  let svg = `<text x="${fmt(F.ml - 6)}" y="${y + 8.5}" text-anchor="end" font-size="8" fill="${MUTED}">protein</text>`;
  p.codons.forEach((cd) => {
    const lo = Math.min(...cd.cols.map((i) => F.xl(i))); const x0 = lo + 0.5; const w = Math.max(...cd.cols.map((i) => F.xl(i))) + F.step - lo - 1;
    const m = designed.get(cd.residue); const color = m ? MARKER_COLOR(m.role) : "#98a2b3";
    svg += `<rect x="${fmt(x0)}" y="${y}" width="${fmt(w)}" height="11" rx="2.5" fill="${color}" fill-opacity="${m ? 0.2 : 0.08}" stroke="${color}" stroke-opacity="${m ? 1 : 0.5}"/>`;
    if (w >= 13) svg += `<text x="${fmt(x0 + w / 2)}" y="${y + 8.5}" text-anchor="middle" font-size="8" font-weight="${m ? 700 : 400}" fill="${m ? color : MUTED}">${esc(m ? `${cd.aa}${cd.residue}` : cd.aa)}</text>`;
  });
  return svg;
}

/** Under a clone: its residue at each designed codon (purple or orange as designed, grey as the control, red otherwise) and at up to three codons that changed without being designed. */
function cloneChips(view, F, y) {
  const p = view.protein; if (!p) return "";
  const calls = view.edited.calls; const second = view.edited.second || ""; const rev = p.strand === "-"; let svg = "";
  const base = (x) => (rev ? COMPL[x] || "N" : x);
  const codonAt = (cols) => { const b = cols.map((i) => calls[i]); return b.some((x) => x === undefined || x === "-") ? null : b.map(base).join(""); };
  const chip = (cols, text, color, title, dashed = false) => {
    const lo = Math.min(...cols.map((i) => F.xl(i))); const x0 = lo + 0.5; const w = Math.max(...cols.map((i) => F.xl(i))) + F.step - lo - 1;
    return `<g><title>${esc(title)}</title><rect x="${fmt(x0)}" y="${y}" width="${fmt(w)}" height="11" rx="2.5" fill="${color}" fill-opacity="0.16" stroke="${color}"${dashed ? ' stroke-dasharray="2 1.5"' : ""}/><text x="${fmt(x0 + w / 2)}" y="${y + 8.5}" text-anchor="middle" font-size="8" font-weight="700" fill="${color}">${esc(text)}</text></g>`;
  };
  const designed = new Set();
  view.markers.forEach((m) => {
    if (!m.protein) return; const cols = m.protein.cols; designed.add(m.protein.residue); const label = m.protein.residue;
    const cd = codonAt(cols);
    if (!cd) { svg += chip(cols, "\u2013", "#98a2b3", `${m.protein.label}: the clone lacks these bases`); return; }
    const mixedCols = cols.filter((i) => second[i] && second[i] !== " ");
    const color = cd === m.protein.codonTo ? MARKER_COLOR(m.role) : cd === m.protein.codonFrom ? "#667085" : "#d92d20";
    const aa = aaOf(cd); let text = `${aa}${label}`; let title = `${m.protein.label}: clone codon ${cd} (${aa}), control ${m.protein.codonFrom}, designed ${m.protein.codonTo}`;
    if (mixedCols.length === 1) {
      const alt = cols.map((i) => (i === mixedCols[0] ? base(second[i]) : base(calls[i]))).join(""); const aaAlt = aaOf(alt);
      text = aa === aaAlt ? text : `${aa}/${aaAlt}${label}`; title += `; a second base is at least 20% of the signal at one position (codon ${alt}, ${aaAlt})`;
      svg += chip(cols, text, color, title, true);
    } else svg += chip(cols, mixedCols.length > 1 ? `${text}?` : text, color, mixedCols.length > 1 ? `${title}; mixed signal at several positions` : title, mixedCols.length > 1);
  });
  if (view.mode === "offset") {
    const changed = [];
    p.codons.forEach((cd) => { if (designed.has(cd.residue)) return; const c = codonAt(cd.cols); if (c && !c.includes("N") && aaOf(c) !== cd.aa) changed.push({ cd, c }); });
    if (changed.length && changed.length <= 3) changed.forEach(({ cd, c }) => { svg += chip(cd.cols, `${cd.aa}${cd.residue}${aaOf(c)}`, "#d92d20", `Not designed: ${cd.aa}${cd.residue}${aaOf(c)} (codon ${c})`); });
  }
  return svg;
}

function guideLines(view, F, top, bottom) {
  const bands = view.markers.map((m) => `<rect x="${fmt(F.xl(m.at))}" y="${top}" width="${fmt(F.step)}" height="${bottom - top}" fill="${MARKER_COLOR(m.role)}" fill-opacity="0.13"/>`).join("");
  const cuts = view.guides.map((g) => `<line x1="${fmt(F.xl(g.cut))}" x2="${fmt(F.xl(g.cut))}" y1="${top}" y2="${bottom}" stroke="${CUT}" stroke-width="0.9" stroke-dasharray="3 2"/>`).join("");
  return { bands, cuts };
}

function letters(calls, F, y, ref = null, second = null) {
  let out = ""; const show = F.step >= 6.2; const fs = Math.min(9, F.step * 1.1);
  for (let i = 0; i < calls.length; i += 1) {
    const c = calls[i]; const diff = ref !== null && c !== ref[i] && c !== "-" && c !== "N";
    if (c === "-") continue;
    const sec = second && second[i] !== " " ? second[i] : "";
    if (!show && !diff && !sec) continue;
    if (diff) out += `<rect x="${fmt(F.xl(i) + 0.4)}" y="${y - 9}" width="${fmt(Math.max(5, F.step - 0.8))}" height="11" rx="2" fill="#fee4e2" stroke="${CUT}" stroke-width="0.7"/>`;
    if (show || diff) out += `<text x="${fmt(F.x(i))}" y="${y}" text-anchor="middle" font-size="${fmt(show ? fs : 7)}" font-family="Courier New, monospace"${diff ? ' font-weight="700"' : ""} fill="${CHANNEL[c] || "#667085"}">${esc(c)}</text>`;
    if (sec) out += `<text x="${fmt(F.x(i))}" y="${y - 9.5}" text-anchor="middle" font-size="6.5" font-family="Courier New, monospace" font-weight="700" fill="${CHANNEL[sec]}"><title>second base at least 20% of the signal</title>${esc(sec)}</text>`;
  }
  return out;
}

const num = (v) => String(Number(v.toFixed(1)));

function strip(curves, calls, F, y0, h, { lw = 1 } = {}) {
  let out = "";
  for (const b of "ACGT") {
    const P = curves[b].length / F.n; const segments = []; let current = null;
    for (let i = 0; i < F.n; i += 1) {
      if (calls && calls[i] === "-") { current = null; continue; }
      if (!current) { current = []; segments.push(current); }
      for (let s = 0; s < P; s += 1) current.push([Number((F.xl(i) + ((s + 0.5) / P) * F.step).toFixed(1)), Number((y0 + h - (curves[b][i * P + s] / 100) * (h - 2)).toFixed(1))]);
    }
    for (const seg of segments) {
      const keep = seg.filter((p, k) => k === 0 || k === seg.length - 1 || !(seg[k - 1][1] === p[1] && seg[k + 1][1] === p[1])); // flat stretches need only their ends
      out += `<polyline points="${keep.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}" fill="none" stroke="${CHANNEL[b]}" stroke-width="${lw}" stroke-linejoin="round"/>`;
    }
  }
  return `${out}<line x1="${F.ml}" x2="${fmt(F.ml + F.w)}" y1="${y0 + h}" y2="${y0 + h}" stroke="#d0d5dd"/>`;
}

function gapBlocks(view, F, y0, h, withLabel = true) {
  let out = ""; const calls = view.edited.calls; let i = 0;
  while (i < calls.length) {
    if (calls[i] !== "-") { i += 1; continue; }
    let j = i; while (j + 1 < calls.length && calls[j + 1] === "-") j += 1;
    out += `<rect x="${fmt(F.xl(i))}" y="${y0}" width="${fmt(F.xl(j + 1) - F.xl(i))}" height="${h}" fill="#f2f4f7" stroke="#d0d5dd" stroke-dasharray="2 2"/>`;
    if (withLabel) out += `<text x="${fmt((F.xl(i) + F.xl(j + 1)) / 2)}" y="${y0 + h / 2 + 3}" text-anchor="middle" font-size="9" fill="${MUTED}">\u2212${j - i + 1} bp</text>`;
    i = j + 1;
  }
  (view.edited.insertions || []).forEach((ins) => { out += `<path d="M${fmt(F.xl(ins.before))},${y0 + h - 1} l-3,7 l6,0 z" fill="#7a5af8"><title>${ins.n} extra base${ins.n === 1 ? "" : "s"} in the clone</title></path><text x="${fmt(F.xl(ins.before))}" y="${y0 + h + 17}" text-anchor="middle" font-size="8" fill="#7a5af8">+${ins.n}</text>`; });
  return out;
}

function mismatchBands(view, F, y0, h) {
  let out = ""; for (let i = 0; i < F.n; i += 1) { const c = view.edited.calls[i]; if (c !== "-" && c !== "N" && c !== view.control.calls[i]) out += `<rect x="${fmt(F.xl(i))}" y="${y0}" width="${fmt(F.step)}" height="${h}" fill="#fee4e2" fill-opacity="0.9"/>`; }
  return out;
}

const svgOpen = (width, height, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="${esc(label)}"><rect width="100%" height="100%" fill="#ffffff"/>`;

function legend(F, x, y, view) {
  const items = [["#1a9850", "A"], ["#2166ac", "C"], ["#222222", "G"], ["#d73027", "T"]]; let out = ""; let cx = x;
  items.forEach(([c, t]) => { out += `<rect x="${cx}" y="${y - 7}" width="8" height="8" fill="${c}"/><text x="${cx + 11}" y="${y}" font-size="8.5" fill="${MUTED}">${t}</text>`; cx += 28; });
  out += `<text x="${cx + 6}" y="${y}" font-size="8.5" fill="${MUTED}">Shaded column: designed change (orange blocks a PAM, purple is the edit). Dashed red line: cut.</text>`;
  out += `<text x="${x}" y="${y + 12}" font-size="8.5" fill="${MUTED}">Red base: differs from the control. Grey block: bases the clone lacks.${view.mode === "gapped" ? "" : " The clone is laid onto the control at the offset used in the analysis."}</text>`;
  if (view.protein) out += `<text x="${x}" y="${y + 24}" font-size="8.5" fill="${MUTED}">Protein row: the control in the reading frame of the design. Box under a clone: its residue at each designed codon (as designed: purple or orange; as the control: grey; other: red).</text>`;
  return out;
}

/** One clone against its wild-type control, annotated. */
export function cloneAlignedFigure(view, { name = "clone", decision = "", headline = "", width = 980 } = {}) {
  if (!view) return "";
  const ml = 92; const mr = 14; const F = frame(view, { width, ml, mr }); const h = 56;
  const top = 44; const ann = annotation(view, F, top); const yC = top + ann.height + 12; const yE = yC + 12 + h + 22; const bottom = yE + 12 + h;
  const [chip, chipBg, chipLine] = DECISION[decision] || ["", "#f2f4f7", "#98a2b3"]; const gl = guideLines(view, F, yC - 12, bottom);
  const height = bottom + 46 + (view.protein ? 14 : 0);
  let svg = svgOpen(width, height, `${name} aligned with the wild-type control`);
  svg += `<text x="8" y="18" font-size="13" font-weight="700" fill="${INK}">${esc(name)}</text>`;
  if (chip) svg += `<rect x="8" y="24" width="14" height="14" rx="3" fill="${chipBg}" stroke="${chipLine}"/><text x="15" y="35" text-anchor="middle" font-size="9.5" fill="${INK}">${chip}</text>`;
  svg += `<text x="${chip ? 28 : 8}" y="35" font-size="10.5" fill="${MUTED}">${esc([DECISION_LABEL[decision], headline].filter(Boolean).join(" \u00b7 "))}</text>`;
  svg += ann.svg + gl.bands + mismatchBands(view, F, yE, h + 12);
  svg += `<text x="8" y="${yC + 30}" font-size="10" font-weight="700" fill="${INK}">Wild type</text><text x="8" y="${yC + 42}" font-size="8.5" fill="${MUTED}">control</text>`;
  svg += letters(view.control.calls, F, yC) + strip(view.control.curves, null, F, yC + 4, h);
  svg += `<text x="8" y="${yE + 30}" font-size="10" font-weight="700" fill="${INK}">${esc(name.length > 14 ? `${name.slice(0, 13)}\u2026` : name)}</text><text x="8" y="${yE + 42}" font-size="8.5" fill="${MUTED}">clone</text>`;
  svg += gapBlocks(view, F, yE + 4, h) + letters(view.edited.calls, F, yE, view.control.calls, view.edited.second) + strip(view.edited.curves, view.edited.calls, F, yE + 4, h) + cloneChips(view, F, yE + 4 + h + 3);
  svg += gl.cuts + legend(F, ml, bottom + 26, view) + "</svg>";
  return svg;
}

/** One clone as the figures take it: its name, decision, a short note, and its view. */
export function alignedItem(r) {
  const s = r.summary || {};
  return { name: r.name, decision: r.decision ? r.decision.decision : "", note: r.workflow === "snp" || r.workflow === "tag_small" ? `HDR score ${s.intendedEditPct}%` : (s.intendedEditPct > 0 ? `intended edit ${s.intendedEditPct}%` : `edited ${s.editedPct}%`), view: r.view };
}

/** Items of one design, best clone first: [{ name, decision, note, view }] per group of samples that share a design and stretch. */
export function alignedGroups(results) {
  const groups = new Map();
  summaryOrder(results).forEach((i) => {
    const r = results[i]; if (!r || !r.ok || !r.view) return; const v = r.view;
    const key = `${v.length}|${v.guides.map((g) => g.name).join(",")}|${v.markers.map((m) => `${m.label}${m.change}`).join(",")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alignedItem(r));
  });
  return [...groups.values()];
}

/** All clones of one design on the same stretch: the control, then every clone's chromatogram, best first. */
export function clonesAlignedFigure(items, { title = "All clones aligned with the wild-type control", width = 980 } = {}) {
  if (!items || !items.length) return "";
  const v0 = items[0].view; const ml = 150; const mr = 14; const F = frame(v0, { width, ml, mr }); const h = 30; const rowH = h + 16 + (v0.protein ? 12 : 0);
  const top = 34; const ann = annotation(v0, F, top); const y0 = top + ann.height + 10; const bottom = y0 + (items.length + 1) * rowH; const gl = guideLines(v0, F, y0 - 2, bottom);
  const height = bottom + 40 + (v0.protein ? 14 : 0); let svg = svgOpen(width, height, title);
  svg += `<text x="8" y="18" font-size="13" font-weight="700" fill="${INK}">${esc(title)}</text>` + ann.svg + gl.bands;
  const rows = [{ name: "Wild type", sub: "control", view: v0, control: true }, ...items];
  rows.forEach((it, r) => {
    const y = y0 + r * rowH; const v = it.view; const [chip, bg, line] = it.control ? ["", "", ""] : DECISION[it.decision] || ["", "#f2f4f7", "#98a2b3"];
    svg += `<text x="8" y="${y + 21}" font-size="10" font-weight="700" fill="${INK}">${esc(it.name.length > 17 ? `${it.name.slice(0, 16)}\u2026` : it.name)}</text>`;
    if (chip) svg += `<rect x="${ml - 24}" y="${y + 10}" width="14" height="14" rx="3" fill="${bg}" stroke="${line}"/><text x="${ml - 17}" y="${y + 21}" text-anchor="middle" font-size="9.5" fill="${INK}">${chip}</text>`;
    svg += `<text x="8" y="${y + 33}" font-size="8" fill="${MUTED}">${esc(it.control ? it.sub : it.note)}</text>`;
    if (it.control) svg += letters(v.control.calls, F, y + 9) + strip(v.control.curves, null, F, y + 12, h, { lw: 0.8 });
    else svg += mismatchBands(v, F, y, h + 12) + gapBlocks(v, F, y + 12, h, true) + letters(v.edited.calls, F, y + 9, v.control.calls, v.edited.second) + strip(v.edited.curves, v.edited.calls, F, y + 12, h, { lw: 0.8 }) + cloneChips(v, F, y + 12 + h + 2);
  });
  svg += gl.cuts + legend(F, ml, bottom + 18, v0) + "</svg>";
  return svg;
}

/** The base calls of all clones as an alignment: a dot where the clone agrees with the control, the base where it differs, a dash where it lacks the base. */
export function clonesAlignmentFigure(items, { title = "Base calls of all clones aligned with the wild-type control", width = 980 } = {}) {
  if (!items || !items.length) return "";
  const v0 = items[0].view; const n = v0.length; const ml = 150; const mr = 90; const cw = Math.max(7, Math.min(13, Math.floor((width - ml - mr) / n))); const W = ml + n * cw + mr;
  const F = frame(v0, { width: W, ml, mr }); const rh = 15; const top = 34; const ann = annotation(v0, F, top); const yR = top + ann.height + 14; const yRows = yR + rh + 4;
  const bottom = yRows + items.length * rh; const gl = guideLines(v0, F, yR - 12, bottom); const height = bottom + 44 + (v0.protein ? 12 : 0); let svg = svgOpen(W, height, title);
  svg += `<text x="8" y="18" font-size="13" font-weight="700" fill="${INK}">${esc(title)}</text>` + ann.svg + gl.bands;
  // ruler: bases from the first cut
  const c0 = Math.min(...v0.guides.map((g) => g.cut));
  for (let i = 0; i < n; i += 1) { const rel = i - c0; if (rel % 10 === 0) svg += `<line x1="${fmt(F.xl(i))}" x2="${fmt(F.xl(i))}" y1="${yR - 12}" y2="${yR - 9}" stroke="#98a2b3"/><text x="${fmt(F.xl(i))}" y="${yR - 14}" text-anchor="middle" font-size="7" fill="#98a2b3">${rel > 0 ? "+" : rel < 0 ? "\u2212" : ""}${Math.abs(rel)}</text>`; }
  svg += `<text x="8" y="${yR + 10}" font-size="10" font-weight="700" fill="${INK}">Wild type</text>`;
  for (let i = 0; i < n; i += 1) svg += `<text x="${fmt(F.x(i))}" y="${yR + 10}" text-anchor="middle" font-size="9" font-family="Courier New, monospace" fill="${CHANNEL[v0.control.calls[i]] || "#667085"}">${esc(v0.control.calls[i])}</text>`;
  items.forEach((it, r) => {
    const y = yRows + r * rh; const v = it.view; const [chip, bg, line] = DECISION[it.decision] || ["", "#f2f4f7", "#98a2b3"];
    if (r % 2 === 0) svg += `<rect x="0" y="${y}" width="${W}" height="${rh}" fill="#f9fafb"/>`;
    svg += `<text x="8" y="${y + 11}" font-size="10" fill="${INK}">${esc(it.name.length > 17 ? `${it.name.slice(0, 16)}\u2026` : it.name)}</text>`;
    if (chip) svg += `<rect x="${ml - 24}" y="${y + 1}" width="14" height="13" rx="3" fill="${bg}" stroke="${line}"/><text x="${ml - 17}" y="${y + 11}" text-anchor="middle" font-size="9" fill="${INK}">${chip}</text>`;
    for (let i = 0; i < n; i += 1) {
      const c = v.edited.calls[i]; const ref = v.control.calls[i];
      const sec = v.edited.second ? v.edited.second[i] : " "; const mixed = sec && sec !== " ";
      if (c === "-") svg += `<rect x="${fmt(F.xl(i))}" y="${y + 1}" width="${cw}" height="${rh - 2}" fill="#e4e7ec"/><text x="${fmt(F.x(i))}" y="${y + 11}" text-anchor="middle" font-size="9" fill="${MUTED}">\u2013</text>`;
      else if (c === ref || c === "N" || ref === "N") {
        if (mixed && c !== "N") svg += `<rect x="${fmt(F.xl(i) + 0.5)}" y="${y + 1}" width="${cw - 1}" height="${rh - 2}" rx="2" fill="${CHANNEL[sec]}" fill-opacity="0.16" stroke="${CHANNEL[sec]}" stroke-dasharray="2 1.5"><title>${esc(it.name)}: ${c} with ${sec} (second base at least 20% of the signal)</title></rect><text x="${fmt(F.x(i))}" y="${y + 11}" text-anchor="middle" font-size="8.5" font-family="Courier New, monospace" fill="${CHANNEL[sec]}">${esc(sec)}</text>`;
        else svg += c === "N" ? `<text x="${fmt(F.x(i))}" y="${y + 11}" text-anchor="middle" font-size="8" fill="#98a2b3">N</text>` : `<circle cx="${fmt(F.x(i))}" cy="${y + rh / 2}" r="1.1" fill="#c0c5cd"/>`;
      } else if (mixed) {
        const half = (cw - 1) / 2;
        svg += `<rect x="${fmt(F.xl(i) + 0.5)}" y="${y + 1}" width="${fmt(half)}" height="${rh - 2}" rx="2" fill="${CHANNEL[c] || "#667085"}"/><rect x="${fmt(F.xl(i) + 0.5 + half)}" y="${y + 1}" width="${fmt(half)}" height="${rh - 2}" rx="2" fill="${CHANNEL[sec]}"/><text x="${fmt(F.xl(i) + 0.5 + half / 2)}" y="${y + 10.5}" text-anchor="middle" font-size="6.5" font-weight="700" font-family="Courier New, monospace" fill="#fff">${esc(c)}</text><text x="${fmt(F.xl(i) + 0.5 + half * 1.5)}" y="${y + 10.5}" text-anchor="middle" font-size="6.5" font-weight="700" font-family="Courier New, monospace" fill="#fff">${esc(sec)}</text>`;
      } else svg += `<rect x="${fmt(F.xl(i) + 0.5)}" y="${y + 1}" width="${cw - 1}" height="${rh - 2}" rx="2" fill="${CHANNEL[c] || "#667085"}"/><text x="${fmt(F.x(i))}" y="${y + 11}" text-anchor="middle" font-size="9" font-weight="700" font-family="Courier New, monospace" fill="#fff">${esc(c)}</text>`;
    }
    (v.edited.insertions || []).forEach((ins) => { svg += `<path d="M${fmt(F.xl(ins.before))},${y + 1} l-3,0 l3,6 l3,-6 z" fill="#7a5af8"><title>${esc(it.name)}: ${ins.n} extra base${ins.n === 1 ? "" : "s"} here</title></path>`; });
    svg += `<text x="${fmt(ml + n * cw + 8)}" y="${y + 11}" font-size="8.5" fill="${MUTED}">${esc(it.note)}</text>`;
  });
  svg += gl.cuts + `<text x="${ml}" y="${bottom + 20}" font-size="8.5" fill="${MUTED}">Dot: same base as the control. Coloured base: differs from the control. Dash: the clone lacks the base. Purple triangle: extra bases in the clone.</text><text x="${ml}" y="${bottom + 32}" font-size="8.5" fill="${MUTED}">Dashed or half-and-half cell: a second base is at least 20% of the signal. Dashed red line: cut. Shaded column: designed change.</text>${v0.protein ? `<text x="${ml}" y="${bottom + 44}" font-size="8.5" fill="${MUTED}">Protein row: the control read in the reading frame of the design; designed codons are coloured and numbered.</text>` : ""}</svg>`;
  return svg;
}
