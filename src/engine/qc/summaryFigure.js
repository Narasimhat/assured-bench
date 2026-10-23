// A run on one graph: one row per clone, in the order to act on them. The decision, what each clone is made of (the alleles and their shares of the signal), the
// edited share with its interval, the knockout support or intended-edit lower bound, and what to do with it. Vector SVG with real text, 1 unit = 1 pixel at 96 dpi
// (rasterised by a browser at any dpi); no scripts and no external resources. Hover text (<title>) carries the full name, the allele shares and the decision reasons.

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const INK = "#101828"; const MUTED = "#475467"; const BLUE = "#1b6ca8";
// the colours of the allele chart in the sample detail, so one key serves both
const KIND = { wt: ["#667085", "Wild type"], indel: ["#d92d20", "Indel at one cut"], deletion_between_cuts: ["#b54708", "Deletion between the cuts"], edit: ["#067647", "Intended edit"], edit_partial: ["#7a5af8", "Partial conversion"], edit_indel: ["#c11574", "Edit with an indel"] };
const OTHER = "#98a2b3";
const DECISION = { accept: ["A", "#d1fadf", "#12b76a"], hold: ["H", "#fef0c7", "#f79009"], "re-sequence": ["S", "#d1e9ff", "#2e90fa"], reject: ["R", "#fee4e2", "#f04438"] };
const DECISION_LABEL = { accept: "Accept", hold: "Hold", "re-sequence": "Sequence again", reject: "Reject" };
const TIER_OPACITY = { confirmed: 1, firm: 1, likely: 0.8, possible: 0.62, unsupported: 0.35 };
const PLAN = { first: "carry forward", confirmed: "confirmed", reserve: "reserve", duplicate: "backup", caution: "protein still made", not_recommended: "not recommended", discard: "discard", resequence: "sequence again" };
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

const sizeLabel = (c) => (c.kind === "wt" ? "WT" : c.size ? `${c.size > 0 ? "+" : "\u2212"}${Math.abs(c.size)}` : c.kind === "edit" ? "edit" : "");
const attention = (r) => !!(r.recommendation && r.recommendation.flags && r.recommendation.flags.some((f) => /trace quality|low confidence/.test(f)));

/** The rows in the order to act on them: ranked clones first, then the rest in input order. */
export function summaryOrder(results) {
  const idx = results.map((r, i) => i); const rank = (i) => results[i].recommendation && results[i].recommendation.rank;
  return idx.sort((a, b) => { const ra = rank(a); const rb = rank(b); if (ra != null && rb != null) return ra - rb; if (ra != null) return -1; if (rb != null) return 1; return a - b; });
}

export function runSummaryFigure(results, { title = "", width = 980, generatedLabel = "" } = {}) {
  if (!results || !results.length) return "";
  const order = summaryOrder(results); const n = order.length;
  const rh = n <= 30 ? 28 : n <= 80 ? 20 : 15; const labels = rh >= 20; const fs = rh >= 20 ? 11 : 9;
  const NAME = { x: 14, w: 196 }; const CHIP = 222; const COMP = { x: 280, w: 252 }; const EDIT = { x: 560, w: 156 }; const SUP = { x: 744, w: 80 }; const PLANX = 856;
  const koRun = results.some((r) => r.workflow === "knockout" || r.workflow === "deletion");
  // without a gene record the number in the support column is the KO score (as ICE and DECODR report it); with one it is the functional prediction
  // SNP and small-tag runs: the intended-edit share is the HDR score (ICE calls it the KI score)
  const hdrRun = !koRun && results.some((r) => r.workflow === "snp" || r.workflow === "tag_small");
  const koScoreRun = koRun && !results.some((r) => r.recommendation && /^functional/.test(r.recommendation.basis || ""));
  const counts = { accept: 0, hold: 0, "re-sequence": 0, reject: 0 }; results.forEach((r) => { if (r.decision && counts[r.decision.decision] !== undefined) counts[r.decision.decision] += 1; });
  const parts = []; let y = 6;
  parts.push(`<text x="14" y="${y + 13}" font-size="13" fill="${INK}">${esc(title || `Run summary: ${n} sample${n === 1 ? "" : "s"}`)}</text>`); y += 20;
  parts.push(`<text x="14" y="${y + 10}" font-size="11" fill="${MUTED}">${Object.keys(DECISION).map((k) => `${DECISION_LABEL[k]} ${counts[k]}`).join("   \u00b7   ")}${generatedLabel ? `   \u00b7   ${esc(generatedLabel)}` : ""}</text>`); y += 22;
  // column headers and axes
  const hy = y + 10;
  parts.push(`<text x="${NAME.x}" y="${hy}" font-size="10" fill="${MUTED}">Sample (best first)</text><text x="${CHIP - 4}" y="${hy}" font-size="10" fill="${MUTED}">Decision</text>`);
  parts.push(`<text x="${COMP.x}" y="${hy - 12}" font-size="10" fill="${MUTED}">What the clone is made of (share of the signal)</text>`);
  parts.push(`<text x="${EDIT.x}" y="${hy - 12}" font-size="10" fill="${MUTED}">${koRun ? "Edited share" : hdrRun ? "HDR score" : "Intended edit"}, 95% interval</text>`);
  parts.push(`<text x="${SUP.x}" y="${hy - 12}" font-size="10" fill="${MUTED}">${koRun ? (koScoreRun ? "KO score" : "Knockout support") : hdrRun ? "Lower bound" : "Support"}</text><text x="${PLANX}" y="${hy}" font-size="10" fill="${MUTED}">Plan</text>`);
  [0, 50, 100].forEach((v) => { parts.push(`<text x="${COMP.x + (COMP.w * v) / 100}" y="${hy}" font-size="9" text-anchor="${v === 0 ? "start" : v === 100 ? "end" : "middle"}" fill="${MUTED}">${v}%</text><text x="${EDIT.x + (EDIT.w * v) / 100}" y="${hy}" font-size="9" text-anchor="${v === 0 ? "start" : v === 100 ? "end" : "middle"}" fill="${MUTED}">${v}</text>`); });
  parts.push(`<text x="${SUP.x}" y="${hy}" font-size="9" fill="${MUTED}">0</text><text x="${SUP.x + SUP.w}" y="${hy}" font-size="9" text-anchor="end" fill="${MUTED}">100</text>`);
  y += 18; const top = y; const kindsSeen = new Set(); let hasUnexplained = false;
  // light guides for the 50% positions
  order.forEach((i, row) => {
    const r = results[i]; const ry = top + row * rh; const mid = ry + rh / 2; const cell = rh - 6;
    if (row % 2 === 0) parts.push(`<rect x="8" y="${ry}" width="${width - 16}" height="${rh}" fill="#f9fafb"/>`);
    const full = `${r.well ? `${r.well} ` : ""}${r.name}`; const shown = full.length > (labels ? 30 : 36) ? `${full.slice(0, labels ? 29 : 35)}\u2026` : full;
    const dec = r.decision && DECISION[r.decision.decision]; const rec = r.recommendation;
    parts.push(`<g><title>${esc(`${full}${r.decision ? `: ${DECISION_LABEL[r.decision.decision] || r.decision.decision}. ${(r.decision.reasons || []).join(" ")} ${r.decision.next || ""}` : ""}`)}</title>`);
    parts.push(`<text x="${NAME.x}" y="${mid + fs / 3}" font-size="${fs}" fill="${INK}">${esc(shown)}</text>${attention(r) ? `<text x="${NAME.x + NAME.w + 4}" y="${mid + fs / 3}" font-size="${fs + 2}" fill="#b54708">!</text>` : ""}`);
    if (dec) parts.push(`<rect x="${CHIP}" y="${mid - cell / 2}" width="${cell}" height="${cell}" rx="3" fill="${dec[1]}" stroke="${dec[2]}" stroke-width="1.5"/><text x="${CHIP + cell / 2}" y="${mid + fs / 3}" font-size="${fs}" text-anchor="middle" fill="${INK}">${dec[0]}</text>`);
    if (!r.ok || r.kind === "junction" || !r.contributions) { parts.push(`<text x="${COMP.x}" y="${mid + fs / 3}" font-size="${fs}" fill="${MUTED}">${esc(!r.ok ? (r.error || "not analysed").slice(0, 70) : r.kind === "junction" ? `Junction read: ${r.verdict ? r.verdict.status : ""}` : "")}</text>`); parts.push("</g>"); return; }
    // composition: wild type first, then the alleles by share, then what no allele explains
    const cs = r.contributions.filter((c) => (c.fraction || 0) > 0.004).slice().sort((a, b) => (a.kind === "wt" ? -1 : 0) - (b.kind === "wt" ? -1 : 0) || b.fraction - a.fraction);
    let x = COMP.x; let used = 0; const prevKind = {};
    cs.forEach((c) => {
      const w = Math.max(0.8, c.fraction * COMP.w); const color = (KIND[c.kind] || [OTHER])[0]; kindsSeen.add(c.kind); const alt = prevKind[c.kind] ? 0.68 : 1; prevKind[c.kind] = !prevKind[c.kind];
      parts.push(`<rect x="${x.toFixed(1)}" y="${mid - cell / 2}" width="${w.toFixed(1)}" height="${cell}" fill="${color}" fill-opacity="${alt}" stroke="#fff" stroke-width="0.6"><title>${esc(`${c.label}: ${(c.fraction * 100).toFixed(1)}%`)}</title></rect>`);
      if (labels && w >= 34 && sizeLabel(c)) parts.push(`<text x="${(x + w / 2).toFixed(1)}" y="${mid + fs / 3}" font-size="${fs - 1}" text-anchor="middle" fill="#fff">${esc(sizeLabel(c))}</text>`);
      x += w; used += c.fraction;
    });
    if (used < 0.995) { hasUnexplained = true; parts.push(`<rect x="${x.toFixed(1)}" y="${mid - cell / 2}" width="${(COMP.x + COMP.w - x).toFixed(1)}" height="${cell}" fill="#eaecf0" stroke="#d0d5dd" stroke-width="0.6"><title>${esc(`Signal no allele explains: ${((1 - used) * 100).toFixed(1)}%`)}</title></rect>`); }
    // edited share (or intended edit) with its interval
    const intended = r.workflow !== "knockout" && r.workflow !== "deletion"; const iv = r.intervals && (intended ? r.intervals.intendedEditPct : r.intervals.editedPct); const val = r.summary ? (intended ? r.summary.intendedEditPct : r.summary.editedPct) : null;
    const ex = (v) => EDIT.x + (EDIT.w * Math.max(0, Math.min(100, v))) / 100;
    parts.push(`<line x1="${EDIT.x}" y1="${mid}" x2="${EDIT.x + EDIT.w}" y2="${mid}" stroke="#d0d5dd" stroke-width="1"/>`);
    if (iv) parts.push(`<line x1="${ex(iv[0]).toFixed(1)}" y1="${mid}" x2="${ex(iv[1]).toFixed(1)}" y2="${mid}" stroke="${MUTED}" stroke-width="2.2"/><line x1="${ex(iv[0]).toFixed(1)}" y1="${mid - 4}" x2="${ex(iv[0]).toFixed(1)}" y2="${mid + 4}" stroke="${MUTED}" stroke-width="1.2"/><line x1="${ex(iv[1]).toFixed(1)}" y1="${mid - 4}" x2="${ex(iv[1]).toFixed(1)}" y2="${mid + 4}" stroke="${MUTED}" stroke-width="1.2"/>`);
    if (val !== null && val !== undefined) parts.push(`<circle cx="${ex(val).toFixed(1)}" cy="${mid}" r="3.6" fill="${INK}"><title>${esc(`${val}%${iv ? ` (${iv[0]}-${iv[1]})` : ""}`)}</title></circle>`);
    // support and plan
    if (rec && rec.score !== null && rec.score !== undefined && rec.priority !== "none") {
      const op = TIER_OPACITY[rec.tier] ?? 0.6; parts.push(`<rect x="${SUP.x}" y="${mid - cell / 2 + 2}" width="${SUP.w}" height="${cell - 4}" fill="#eef2f6"/><rect x="${SUP.x}" y="${mid - cell / 2 + 2}" width="${((SUP.w * rec.score) / 100).toFixed(1)}" height="${cell - 4}" fill="${BLUE}" fill-opacity="${op}"><title>${esc(`${rec.basis}: ${rec.score} (${rec.tier})`)}</title></rect>`);
      parts.push(`<text x="${SUP.x + SUP.w + 5}" y="${mid + fs / 3}" font-size="${fs}" fill="${INK}">${rec.score}</text>`);
      if (labels) parts.push(`<text x="${PLANX + 20}" y="${mid + fs / 3}" font-size="${fs}" fill="${INK}">${rec.rank != null ? `#${rec.rank} ` : ""}${esc(PLAN[rec.priority] || "")}</text>`);
    } else if (rec && PLAN[rec.priority] && labels) parts.push(`<text x="${PLANX + 20}" y="${mid + fs / 3}" font-size="${fs}" fill="${MUTED}">${esc(PLAN[rec.priority])}</text>`);
    parts.push("</g>");
  });
  y = top + n * rh + 8;
  // axis lines at 50%
  [COMP.x + COMP.w / 2].forEach((x) => parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + n * rh}" stroke="#667085" stroke-width="0.6" stroke-dasharray="2 3"/>`));
  // key
  let kx = 14; const ky = y + 4; const keyKinds = [...kindsSeen].filter((k) => KIND[k]);
  keyKinds.forEach((k) => { parts.push(`<rect x="${kx}" y="${ky}" width="11" height="11" fill="${KIND[k][0]}"/><text x="${kx + 16}" y="${ky + 10}" font-size="11" fill="${INK}">${esc(KIND[k][1])}</text>`); kx += 24 + KIND[k][1].length * 6; });
  if (hasUnexplained) { parts.push(`<rect x="${kx}" y="${ky}" width="11" height="11" fill="#eaecf0" stroke="#d0d5dd"/><text x="${kx + 16}" y="${ky + 10}" font-size="11" fill="${INK}">Signal no allele explains</text>`); }
  y = ky + 22;
  const foot = [
    `Numbers inside the bars are the length change in bp of each allele (WT = wild type). Two alleles of one kind alternate in shade. The dot is the estimate and the line its 95% interval. ! = low trace quality or low confidence in the result.`,
    koScoreRun ? `KO score, as in ICE: the share of alleles with a frameshift or an indel of 21 bp or more (the share that is not wild type). It says the change is likely to disrupt the gene, not that the protein is gone; a Western blot shows that. Clones are ranked by it (docs/recommendation.md).` : koRun ? `Knockout support ranks the clones by how strongly the sequence predicts that no functional protein is left: 100 x (1 - mean allele risk), 85 at best from sequence, 100 only with a protein result. The weights are provisional (docs/recommendation.md).` : hdrRun ? `HDR score (ICE's KI score): the share of alleles that carry the intended edit; blocking changes without the edit are not counted. Clones are ranked by the lower bound of its 95% interval.` : `Support is the lower bound of the intended-edit interval.`,
  ];
  const wrap = (t, max = 175) => { const words = t.split(" "); const lines = []; let line = ""; words.forEach((w) => { if ((line + " " + w).trim().length > max) { lines.push(line); line = w; } else line = (line + " " + w).trim(); }); if (line) lines.push(line); return lines; };
  foot.forEach((t) => wrap(t).forEach((line) => { parts.push(`<text x="14" y="${y + 10}" font-size="10" fill="${MUTED}">${esc(line)}</text>`); y += 13; }));
  const height = Math.ceil(y + 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif" role="img"><title>${esc(title || "Run summary")}</title><rect width="${width}" height="${height}" fill="#fff"/>${parts.join("")}</svg>`;
}
