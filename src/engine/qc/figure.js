// Publication figure for one sample: the control and edited chromatograms over the same stretch of the read (continuous curves, aligned by base),
// the cut sites, the base calls, and the alleles with their intervals. Vector SVG with real text, 1 unit = 1 pixel at 96 dpi; a browser rasterises it at any dpi.
import { parseAbif } from "./abif.js";
import { analyseSample } from "./batch.js";
import { decide } from "./decision.js";
import { prepareSample } from "./prepare.js";

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHANNEL = { A: "#1a9850", C: "#2166ac", G: "#222222", T: "#d73027" };
const KIND_COLOR = { wt: "#667085", indel: "#d92d20", deletion_between_cuts: "#b54708", edit: "#067647", edit_partial: "#7a5af8", edit_indel: "#c11574" };

function panel({ trace, shift, from, to, x, y0, h, label, calls = true }) {
  // samples of the stretch, mapped to base units through the peak locations
  const n = trace.peakLocations.length; const paths = [];
  const lo = Math.max(0, from + shift - 1); const hi = Math.min(n - 2, to + shift + 1);
  let peak = 1; for (const base of "ACGT") { const ch = trace.channels[base]; for (let s = trace.peakLocations[lo]; s <= trace.peakLocations[hi]; s += 1) if (ch[s] > peak) peak = ch[s]; }
  const xOf = (s, k) => { const a = trace.peakLocations[k]; const b = trace.peakLocations[k + 1]; return x(k - shift + (s - a) / Math.max(1, b - a)); };
  for (const base of "ACGT") {
    const ch = trace.channels[base]; let d = ""; let first = true;
    for (let k = lo; k <= hi; k += 1) { const a = trace.peakLocations[k]; const b = trace.peakLocations[k + 1]; const step = Math.max(1, Math.floor((b - a) / 5)); for (let s = a; s < b; s += step) { d += `${first ? "M" : "L"}${xOf(s, k).toFixed(1)},${(y0 + h - (Math.max(0, ch[s]) / peak) * h).toFixed(1)}`; first = false; } }
    paths.push(`<path d="${d}" fill="none" stroke="${CHANNEL[base]}" stroke-width="1.1" stroke-linejoin="round"/>`);
  }
  let letters = "";
  if (calls) for (let j = from; j <= to; j += 1) { const k = j + shift; if (k < 0 || k >= n) continue; const base = trace.calls[k]; letters += `<text x="${x(j).toFixed(1)}" y="${y0 - 3}" text-anchor="middle" font-size="7" font-family="Courier New, monospace" fill="${CHANNEL[base] || "#667085"}">${esc(base)}</text>`; }
  return `<text x="2" y="${y0 + 10}" font-size="10" font-weight="700" fill="#344054">${esc(label)}</text><line x1="${x(from).toFixed(1)}" x2="${x(to).toFixed(1)}" y1="${y0 + h}" y2="${y0 + h}" stroke="#d0d5dd"/>${letters}${paths.join("")}`;
}

/** @returns {{ svg: string, result: object }} */
export function chromatogramFigure({ name = "sample", controlTrace, editedTrace, spec, sampleType = "clone", workflow = "knockout", options = {}, width = 900, span = [40, 80] }) {
  const prepared = prepareSample({ control: controlTrace, edited: editedTrace, spec, options });
  if (!prepared.ok) return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="60"><text x="10" y="30" font-family="Arial" font-size="12" fill="#b42318">${esc(prepared.error)}</text></svg>`, result: null };
  const result = analyseSample({ name, spec, control: controlTrace, edited: editedTrace, sampleType, options });
  const decision = result.ok ? decide(workflow, { ...result, sampleType }) : null;
  const first = prepared.firstCut; const last = prepared.lastCut; const from = Math.max(0, first - span[0]); const to = Math.min(controlTrace.calls.length - 2, last + span[1]);
  const ml = 70; const mr = 16; const w = width - ml - mr; const x = (j) => ml + ((j - from) / Math.max(1, to - from)) * w;
  const ph = 100; const top = 74; const gap = 34; const y1 = top; const y2 = top + ph + gap;
  const cuts = prepared.cuts.map((c) => `<line x1="${x(c.readIndex).toFixed(1)}" x2="${x(c.readIndex).toFixed(1)}" y1="${y1 - 10}" y2="${y2 + ph}" stroke="#7a5af8" stroke-dasharray="4 3" stroke-width="1.2"/><text x="${(x(c.readIndex) + 3).toFixed(1)}" y="${y1 - 12}" font-size="9" fill="#7a5af8">${esc(c.guide.name.replace(/^.*_/, "cut "))}</text>`).join("");
  const bars = result.ok ? result.contributions.slice(0, 4).map((c, i) => { const yy = y2 + ph + 30 + i * 18; const bw = 300 * c.fraction; return `<text x="${ml + 270}" y="${yy + 11}" text-anchor="end" font-size="10" fill="#344054">${esc(c.label.slice(0, 44))}</text><rect x="${ml + 278}" y="${yy + 1}" width="${Math.max(1, bw).toFixed(1)}" height="12" rx="2" fill="${KIND_COLOR[c.kind] || "#667085"}"/><text x="${ml + 284 + bw}" y="${yy + 11}" font-size="10" fill="#344054">${(c.fraction * 100).toFixed(1)}%</text>`; }).join("") : "";
  const iv = result.ok && result.intervals ? result.intervals.editedPct : null;
  const title = result.ok ? `${name}: edited ${result.summary.editedPct}%${iv ? ` (95% interval ${iv[0]}-${iv[1]}%)` : ""}${decision ? `; ${decision.decision}` : ""}` : name;
  const height = y2 + ph + 30 + 4 * 18 + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="${esc(title)}"><rect width="100%" height="100%" fill="#ffffff"/>` +
    `<text x="${ml}" y="20" font-size="14" font-weight="700" fill="#101828">${esc(title)}</text>` +
    `<text x="${ml}" y="36" font-size="10" fill="#667085">${esc(result.ok && result.confidence ? `confidence ${result.confidence.tier} (interval width ${result.confidence.width} points); Assured QC` : "Assured QC")}</text>` +
    `<text x="${ml}" y="${top - 26}" font-size="9" fill="#667085">read position (bases)</text>` +
    panel({ trace: controlTrace, shift: 0, from, to, x, y0: y1, h: ph, label: "control" }) + panel({ trace: editedTrace, shift: prepared.shift, from, to, x, y0: y2, h: ph, label: "edited" }) + cuts +
    `<g>${[0, 1, 2, 3].map((i) => `<rect x="${width - 150 + i * 36}" y="12" width="9" height="9" fill="${Object.values(CHANNEL)[i]}"/><text x="${width - 138 + i * 36}" y="20" font-size="9" fill="#344054">${Object.keys(CHANNEL)[i]}</text>`).join("")}</g>` + bars + `</svg>`;
  return { svg, result: { ...result, decision } };
}

export function figureFromBuffers({ name, control, edited, spec, ...rest }) {
  return chromatogramFigure({ name, controlTrace: parseAbif(control.buffer || control, control.name || "control"), editedTrace: parseAbif(edited.buffer || edited, edited.name || "edited"), spec, ...rest });
}
