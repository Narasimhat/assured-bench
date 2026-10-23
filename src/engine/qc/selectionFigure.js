// One figure from the design to the clones to take forward: the guides, PAMs, cuts and designed changes over the chromatograms of the clones carried
// forward, aligned with the wild-type control, and under them a table of all clones (the share of the donor base at each designed change, the
// genotype read from the sequence, the call and the support) grouped by what to do with them. Built from the views and results of a run; vector SVG
// with real text, 1 unit = 1 pixel at 96 dpi, no scripts and no external resources.
import { alignedItem, clonesAlignedFigure } from "./alignedFigure.js";
import { summaryOrder } from "./summaryFigure.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const INK = "#101828"; const MUTED = "#475467"; const BLUE = "#1b6ca8";
const DECISION = { accept: ["A", "#d1fadf", "#12b76a"], hold: ["H", "#fef0c7", "#f79009"], "re-sequence": ["S", "#d1e9ff", "#2e90fa"], reject: ["R", "#fee4e2", "#f04438"] };
const GROUPS = [["first", "Carry forward first"], ["confirmed", "Confirmed"], ["reserve", "Reserve"], ["duplicate", "Backup (same genotype)"], ["caution", "Protein still made"], ["resequence", "Sequence again"], ["not_recommended", "Not recommended"], ["discard", "Discard"]];
const TIER_OPACITY = { confirmed: 1, firm: 1, likely: 0.8, possible: 0.62, unsupported: 0.35 };
const MARKER_COLOR = (role) => (/block/i.test(role) ? "#e08214" : "#7b3294");
const fmt = (x) => x.toFixed(1);
// a clone with a quarter or more of its signal in indel alleles has its bases at the designed changes shifted for those alleles: the table leaves the shares out
const shifted = (r) => (r.contributions || []).filter((c) => ["indel", "deletion_between_cuts", "edit_indel"].includes(c.kind)).reduce((s, c) => s + c.fraction, 0) >= 0.25;
const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);

function parts(svg) {
  const m = svg.match(/^<svg[^>]*viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"[^>]*>/); if (!m) return { height: 0, body: "" };
  return { height: Number(m[2]), body: svg.slice(m[0].length).replace('<rect width="100%" height="100%" fill="#ffffff"/>', "").replace(/<\/svg>\s*$/, "") };
}

/** @returns {string} the SVG, or "" when the run has no clone to rank */
export function cloneSelectionFigure(results, { title = "", width = 980, note = "" } = {}) {
  const rows = summaryOrder(results).map((i) => results[i]).filter((r) => r && r.ok && r.kind !== "junction" && r.recommendation && r.recommendation.priority !== "none");
  if (!rows.length) return "";
  const forward = rows.filter((r) => r.view && ["first", "confirmed"].includes(r.recommendation.priority)).sort((a, b) => a.recommendation.rank - b.recommendation.rank);
  const hdrRun = rows.some((r) => r.workflow === "snp" || r.workflow === "tag_small");
  const n = rows.length; const nForward = rows.filter((r) => ["first", "confirmed"].includes(r.recommendation.priority)).length;
  let y = 0; let out = "";
  const heading = title || `${nForward} of ${n} clone${n === 1 ? "" : "s"} to carry forward first`;
  out += `<text x="12" y="22" font-size="15" font-weight="700" fill="${INK}">${esc(heading)}</text>`; y = 34;
  // a: the chromatograms of the clones to carry forward, with the design drawn over them
  if (forward.length) {
    const a = parts(clonesAlignedFigure(forward.map(alignedItem), { title: "a\u00a0\u00a0\u00a0Clones to carry forward first, aligned with the wild-type control", width }));
    out += `<g transform="translate(0,${y})">${a.body}</g>`; y += a.height + 6;
  }
  // b: the table of all clones
  const first = rows.find((r) => r.markers && r.markers.length); const markers = first ? first.markers.slice(0, 5) : []; const mx = 104; const cw = 62; const gx = mx + markers.length * cw + 12;
  const chipX = width - 268; const barX = width - 232; const barW = 150; const rh = 19; const hh = 18;
  out += `<text x="12" y="${y + 16}" font-size="13" font-weight="700" fill="${INK}">${forward.length ? "b" : "a"}\u00a0\u00a0\u00a0All clones</text>`; y += 30;
  markers.forEach((m, k) => { const cx = mx + k * cw + (cw - 4) / 2; out += `<text x="${cx}" y="${y + 6}" text-anchor="middle" font-size="8" font-weight="700" fill="${MARKER_COLOR(m.role)}">${esc(m.protein ? `${m.protein.label}${m.protein.silent ? " silent" : ""}` : shorten(String(m.label || "change").replace(/ change$/, ""), 11))}</text><text x="${cx}" y="${y + 16}" text-anchor="middle" font-size="8" fill="${MARKER_COLOR(m.role)}">${esc(m.protein ? `${m.protein.codonFrom}>${m.protein.codonTo}` : m.change)}</text>`; });
  out += `<text x="12" y="${y + 16}" font-size="9" fill="${MUTED}">Clone</text><text x="${gx}" y="${y + 16}" font-size="9" fill="${MUTED}">Genotype read from the sequence</text><text x="${chipX + 9}" y="${y + 16}" text-anchor="middle" font-size="9" fill="${MUTED}">Call</text><text x="${barX}" y="${y + 16}" font-size="9" fill="${MUTED}">${hdrRun ? "HDR score (95% interval)" : rows.some((r) => r.workflow === "knockout" || r.workflow === "deletion") ? (rows.some((r) => /^functional/.test((r.recommendation && r.recommendation.basis) || "")) ? "Support" : "KO score") : "Intended edit, lower 95% bound"}</text>`;
  y += 24;
  for (const [priority, label] of GROUPS) {
    const members = rows.filter((r) => r.recommendation.priority === priority); if (!members.length) continue;
    out += `<line x1="12" x2="${width - 12}" y1="${y}" y2="${y}" stroke="#d0d5dd"/><text x="12" y="${y + 13}" font-size="10" font-weight="700" fill="${priority === "first" || priority === "confirmed" ? BLUE : MUTED}">${esc(label)} (${members.length})</text>`; y += hh;
    const collapse = priority === "discard" && members.length >= 4;
    const list = collapse ? [members[0]] : members;
    list.forEach((r) => {
      const [chip, bg, line] = DECISION[r.decision.decision] || ["", "#f2f4f7", "#98a2b3"];
      if (collapse) {
        out += `<text x="12" y="${y + 13}" font-size="10" fill="${INK}">${members.length} clones</text>`;
        markers.forEach((m, k) => { out += `<rect x="${mx + k * cw}" y="${y + 1}" width="${cw - 4}" height="${rh - 2}" rx="2" fill="#f2f4f7"/><text x="${mx + k * cw + (cw - 4) / 2}" y="${y + 13}" text-anchor="middle" font-size="9" fill="${INK}">0</text>`; });
        out += `<text x="${gx}" y="${y + 13}" font-size="9" fill="${INK}">${esc(shorten(members.map((x) => x.name).join(", "), Math.floor((chipX - gx) / 4.9)))}</text>`;
      } else {
        out += `<text x="12" y="${y + 13}" font-size="10" fill="${INK}">${esc(shorten(r.name, 14))}</text>`;
        markers.forEach((m, k) => {
          const row = (r.markers || [])[k]; const v = row && row.covered && !shifted(r) && row.altNet !== null && row.altNet !== undefined ? Math.max(0, Math.min(1, row.altNet)) : null; const x = mx + k * cw;
          if (v === null) out += `<rect x="${x}" y="${y + 1}" width="${cw - 4}" height="${rh - 2}" rx="2" fill="#f2f4f7" stroke="#d0d5dd" stroke-dasharray="2 2"/><text x="${x + (cw - 4) / 2}" y="${y + 13}" text-anchor="middle" font-size="8" fill="${MUTED}">n/a</text>`;
          else { const g = Math.round(242 - v * 213); out += `<rect x="${x}" y="${y + 1}" width="${cw - 4}" height="${rh - 2}" rx="2" fill="rgb(${g},${g + 3},${g + 8})"/><text x="${x + (cw - 4) / 2}" y="${y + 13}" text-anchor="middle" font-size="9" fill="${v > 0.5 ? "#fff" : INK}">${Math.round(v * 100)}</text>`; }
        });
        const genotype = r.genotype && r.genotype.summary ? r.genotype.summary : (r.decision.reasons || [])[0] || "";
        out += `<text x="${gx}" y="${y + 13}" font-size="9" fill="${INK}"><title>${esc(genotype)}</title>${esc(shorten(genotype, Math.floor((chipX - gx - 8) / 4.9)))}</text>`;
      }
      if (chip) out += `<rect x="${chipX}" y="${y + 2}" width="18" height="${rh - 4}" rx="3" fill="${bg}" stroke="${line}" stroke-width="1.2"/><text x="${chipX + 9}" y="${y + 13}" text-anchor="middle" font-size="9.5" fill="${INK}">${chip}</text>`;
      // an edit run shows the HDR score itself (the share of alleles with the intended edit) and its interval; the ranking uses the lower bound
      const hdr = hdrRun && !collapse && r.summary && r.summary.intendedEditPct !== undefined; const iv = hdr && r.intervals && r.intervals.intendedEditPct ? r.intervals.intendedEditPct : null;
      const score = collapse ? 0 : hdr ? r.summary.intendedEditPct : r.recommendation.score || 0; const shown = hdr ? `${Number(score).toFixed(1)}${iv ? ` (${iv[0]}\u2013${iv[1]})` : ""}` : String(Math.round(score));
      out += `<rect x="${barX}" y="${y + 4}" width="${barW}" height="${rh - 8}" fill="#eef2f6"/><rect x="${barX}" y="${y + 4}" width="${fmt((barW * score) / 100)}" height="${rh - 8}" fill="${BLUE}" fill-opacity="${priority === "first" || priority === "confirmed" ? 1 : (TIER_OPACITY[r.recommendation.tier] ?? 0.6) * 0.8}"/><text x="${barX + barW + 6}" y="${y + 13}" font-size="${hdr ? 8 : 9}" fill="${INK}">${shown}</text>`;
      y += rh;
    });
  }
  y += 10;
  const foot = [
    "Table: share of the donor base at each designed change, from the peak heights (0 = control base, 100 = donor base; n/a where an indel shifts the read). Call: A accept, H hold, S sequence again, R reject.",
    ...(hdrRun ? ["HDR score (ICE's KI score): the share of alleles that carry the intended edit, with its 95% interval; clones are ranked by the lower bound of the interval."] : []),
    ...(note ? [note] : []),
    "One read per clone (the first): the figure does not show allele phase, a large deletion on one allele or off-target edits.",
  ];
  foot.forEach((line, i) => { out += `<text x="12" y="${y + 10 + i * 12}" font-size="8.5" fill="${MUTED}">${esc(line)}</text>`; });
  const height = y + 10 + foot.length * 12 + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="${esc(heading)}"><rect width="100%" height="100%" fill="#ffffff"/>${out}</svg>`;
}
