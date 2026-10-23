// One-page plate view of the decisions: which wells to keep, hold, sequence again or discard. Wells come from the file names (A01 ... H12) or a sheet column;
// without them the samples are listed in order. Self-contained HTML, no scripts.
import { DECISION_ORDER, tally } from "./decision.js";
import { panelOf } from "./recommend.js";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLOR = { accept: "#d1fadf", hold: "#fef0c7", "re-sequence": "#d1e9ff", reject: "#fee4e2" };
const BORDER = { accept: "#12b76a", hold: "#f79009", "re-sequence": "#2e90fa", reject: "#f04438" };
const SHORT = { accept: "A", hold: "H", "re-sequence": "S", reject: "R" };

export function buildPlateReportHtml({ title = "Plate", results, generatedAt = new Date() }) {
  const decisions = results.map((r) => r.decision); const counts = tally(decisions);
  const located = results.filter((r) => r.well); const byWell = new Map(); located.forEach((r) => { if (!byWell.has(r.well)) byWell.set(r.well, r); });
  const rows = "ABCDEFGH".split(""); const cols = Array.from({ length: 12 }, (_, i) => i + 1);
  const cell = (r) => `<td title="${esc(`${r.name}: ${r.decision.decision}. ${r.decision.reasons.join(" ")} ${r.decision.next}`)}" style="background:${COLOR[r.decision.decision]};border:2px solid ${BORDER[r.decision.decision]}"><b>${SHORT[r.decision.decision]}</b><br><span>${esc(String(r.name).slice(0, 12))}</span></td>`;
  const grid = byWell.size ? `<table class="plate"><tr><th></th>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>${rows.map((row) => `<tr><th>${row}</th>${cols.map((c) => { const r = byWell.get(`${row}${c}`); return r ? cell(r) : "<td class=\"empty\"></td>"; }).join("")}</tr>`).join("")}</table>` : "";
  const ranked = results.filter((r) => r.recommendation && r.recommendation.rank != null).sort((a, b) => a.recommendation.rank - b.recommendation.rank);
  const PRIORITY = { first: "Carry forward", confirmed: "Confirmed", reserve: "Reserve", duplicate: "Backup", caution: "Caution" };
  const hdrScore = ranked.length > 0 && ranked.every((r) => /^HDR score/.test((r.recommendation && r.recommendation.basis) || ""));
  const koScore = ranked.length > 0 && ranked.every((r) => /^KO score/.test((r.recommendation && r.recommendation.basis) || ""));
  const recommendation = ranked.length ? `<h3>Order to carry forward and confirm (${ranked.length})</h3><p>First choice: ${esc(panelOf(results).join(", ") || "none")}. ${hdrScore ? "The HDR score (ICE's KI score: the share of alleles that carry the intended edit) ranks the clones by the lower bound of its 95% interval." : koScore ? "The KO score (as in ICE: the share of alleles with a frameshift or an indel of 21 bp or more) ranks the clones; it says the change is likely to disrupt the gene, not that the protein is gone, which a Western blot shows." : "The knockout support ranks the clones by how strongly the sequence predicts that no functional protein is left (100 only with a protein result); the weights behind it are provisional, so a difference of a few points is not evidence."}</p><table><tr><th>#</th><th>Sample</th><th>Well</th><th>Decision</th><th>${hdrScore ? "HDR score, lower bound" : koScore ? "KO score" : "Support"}</th><th>Plan</th><th>Why</th></tr>${ranked.map((r) => `<tr><td>${r.recommendation.rank}</td><td>${esc(r.name)}</td><td>${esc(r.well || "")}</td><td>${esc(r.decision.decision)}</td><td>${r.recommendation.score} (${esc(r.recommendation.tier)})</td><td><b>${esc(PRIORITY[r.recommendation.priority] || r.recommendation.priority)}</b>. ${esc(r.recommendation.action)}${r.recommendation.flags.length ? ` <i>${esc(r.recommendation.flags.join("; "))}.</i>` : ""}</td><td>${esc(r.recommendation.why.join(" | "))}</td></tr>`).join("")}</table>` : "";
  const list = (kind) => results.filter((r) => r.decision.decision === kind);
  const section = (kind, heading) => list(kind).length ? `<h3>${heading} (${list(kind).length})</h3><table><tr><th>Sample</th><th>Well</th><th>Why</th><th>Next step</th></tr>${list(kind).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.well || "")}</td><td>${esc(r.decision.reasons.join(" "))}</td><td>${esc(r.decision.next)}</td></tr>`).join("")}</table>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} plate report</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#101828;max-width:1100px;margin:24px auto;padding:0 16px;font-size:13px}h1{font-size:20px}h3{font-size:14px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #eaecf0;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f9fafb}
.plate td{width:7.5%;height:46px;text-align:center;font-size:11px;padding:2px}.plate td span{color:#475467;font-size:9px}.plate td.empty{background:#fafafa;border:1px solid #eaecf0}.legend span{display:inline-block;margin-right:14px;padding:2px 8px;border-radius:4px}
</style></head><body><h1>${esc(title)}: plate decisions</h1>
<p class="legend"><span style="background:${COLOR.accept}">A accept ${counts.accept}</span><span style="background:${COLOR.hold}">H hold ${counts.hold}</span><span style="background:${COLOR["re-sequence"]}">S re-sequence ${counts["re-sequence"]}</span><span style="background:${COLOR.reject}">R reject ${counts.reject}</span> &middot; ${results.length} samples &middot; generated ${esc(generatedAt.toISOString().slice(0, 10))}</p>
${grid}${recommendation}${DECISION_ORDER.map((k) => section(k, { accept: "Accept", hold: "Hold", "re-sequence": "Sequence again", reject: "Reject" }[k])).join("")}
<p class="muted">Decisions follow the thresholds in run.json and the reasons listed; they are computed from Sanger traces and need review before a clone is released.</p></body></html>`;
}

export function resequenceListCsv(results) {
  return `sample,well,reason\n${results.filter((r) => r.decision.decision === "re-sequence").map((r) => [r.name, r.well || "", r.decision.reasons.join(" ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")}\n`;
}
