// Self-contained HTML report and CSV for a batch of analysed samples.
import { WORKFLOWS, headline } from "./batch.js";
import { cloneProteinFigure } from "./proteinFigure.js";
import { runSummaryFigure } from "./summaryFigure.js";
import { cloneAlignedFigure, alignedGroups, clonesAlignedFigure, clonesAlignmentFigure } from "./alignedFigure.js";
import { cloneSelectionFigure } from "./selectionFigure.js";
import { panelOf } from "./recommend.js";

export const QC_VERSION = "0.5.2";
const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`);

const STYLE = `
body{font-family:Arial,Helvetica,sans-serif;color:#101828;max-width:980px;margin:24px auto;padding:0 16px;font-size:13px;line-height:1.5}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid #eaecf0;padding-bottom:4px}h3{font-size:14px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}th,td{border:1px solid #eaecf0;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f9fafb;font-size:12px}
.muted{color:#667085}.pass{color:#067647;font-weight:700}.warn{color:#b54708;font-weight:700}.fail{color:#b42318;font-weight:700}
ul{margin:4px 0 10px 18px;padding:0}.note{background:#fffaeb;border:1px solid #fedf89;border-radius:6px;padding:8px 10px;margin:10px 0}
svg{max-width:100%;height:auto}.sample{page-break-inside:avoid}
`;

const DECISION_LABEL = { accept: "Accept", hold: "Hold", "re-sequence": "Sequence again", reject: "Reject" };
const intervalText = (iv) => (iv ? `${iv[0]}-${iv[1]}%` : "n/a");

const METHOD = [
  "Each edited trace is compared with its control. Over a window around the cut(s), the mix of bases at every position is fitted as a non-negative mixture of the alleles expected from the design (wild type, indels at each cut, deletions between cuts, the donor's complete edit, and partial conversions).",
  "Intervals are 95% intervals: the profile of the fit (what the trace cannot tell apart) widened by a margin calibrated on simulated traces built from real controls; they have not yet been calibrated on laboratory mixtures. The confidence tier is the width of the interval, not the number of warnings.",
  "Detection limit is about 5% per allele; abundances are trace-derived estimates, not allele counts. Deletions or insertions larger than the readable window, large deletions on one allele, loss of heterozygosity and copy-number changes are not visible.",
  "A clone call assumes at most two alleles. Sanger traces cannot tell a homozygous clone from one with a large deletion on the other allele.",
  "Junction reads show whether the knock-in sequence is correct and reaches genomic sequence beyond the homology arm; they cannot show zygosity or copy number.",
  "Genome-wide off-target editing is not assessed.",
];

function statusClass(r) {
  if (!r.ok) return "fail";
  if (r.kind === "junction") return r.verdict.status;
  if (r.decision) return r.decision.decision === "accept" ? "pass" : r.decision.decision === "reject" ? "fail" : "warn";
  return r.warnings && r.warnings.length ? "warn" : "pass";
}

function contributionRows(r) {
  return r.contributions.map((c) => `<tr><td>${esc(c.label)}${c.indistinguishable ? ` <span class="muted">(+${c.indistinguishable} indistinguishable on this trace)</span>` : ""}</td><td>${esc(c.kind.replace(/_/g, " "))}</td><td>${pct(c.fraction)}</td></tr>`).join("");
}

function sampleSection(workflow, r, { chromatogram = true } = {}) {
  const hdr = workflow === "snp" || workflow === "tag_small"; const intendedWord = hdr ? "HDR score (intended edit)" : "Intended edit";
  const head = `<div class="sample"><h3>${esc(r.name)}: <span class="${statusClass(r)}">${esc(headline(workflow, r))}</span></h3>`;
  if (!r.ok) return `${head}<p>${esc(r.error)}</p></div>`;
  if (r.kind === "junction") {
    const events = r.events.length ? `<table><tr><th>Difference</th><th>Region</th><th>Allele position</th><th>Detail</th><th>Quality</th></tr>${r.events.map((e) => `<tr><td>${esc(e.type)}${e.expectedChange ? " (designed change)" : ""}</td><td>${esc(e.region)}</td><td>${e.alleleIndex}</td><td>${esc(e.detail)}</td><td>${e.quality}</td></tr>`).join("")}</table>` : "<p>No differences from the expected knock-in sequence in the aligned stretch.</p>";
    const markers = r.markers.length ? `<table><tr><th>Designed change</th><th>Covered</th><th>As designed</th></tr>${r.markers.map((m) => `<tr><td>${esc(m.change)} ${esc(m.label)}</td><td>${m.covered ? "yes" : "no"}</td><td>${m.covered ? (m.present ? "yes" : `no (read shows ${esc(m.base)})`) : "n/a"}</td></tr>`).join("")}</table>` : "";
    return `${head}<ul>${r.verdict.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul><p class="muted">Read orientation ${esc(r.orientation)}; ${r.alignedBases} aligned bases at ${(r.identity * 100).toFixed(1)}% identity; 5' junction spanned: ${r.spans.fivePrimeJunction === null ? "n/a" : r.spans.fivePrimeJunction ? "yes" : "no"}; 3' junction spanned: ${r.spans.threePrimeJunction === null ? "n/a" : r.spans.threePrimeJunction ? "yes" : "no"}; genomic flank bases: ${r.spans.genomicFlankBases}.</p>${events}${markers}</div>`;
  }
  const s = r.summary;
  const numbers = `<table><tr><th>Wild type</th><th>Edited</th><th>Indels</th><th>Between cuts</th><th>${intendedWord}</th><th>Blocking-only</th><th>${r.functional ? "Frameshift score (proxy)" : "KO score (frameshift proxy)"}</th>${r.functional ? "<th>Functional KO</th>" : ""}<th>Unexplained</th></tr><tr><td>${s.wtPct}%</td><td>${s.editedPct}%</td><td>${s.indelPct}%</td><td>${s.betweenCutsPct}%</td><td>${s.intendedEditPct}%</td><td>${s.partialConversionPct}%</td><td>${s.koScorePct}%</td>${r.functional ? `<td>${s.functionalKoPct}%</td>` : ""}<td>${s.unexplainedPct ?? 0}%</td></tr></table>${r.functional || (workflow !== "knockout" && workflow !== "deletion") ? "" : `<p class="muted">KO score here is a frameshift proxy: the share of alleles whose net length change is not divisible by three, or that are at least 21 bp. It does not look at the coding sequence, so an in-frame deletion inside a key domain or a frameshift in the last exon is not told apart. Supply the gene record (GenBank) to get a functional knockout assessment.</p>`}`;
  const decision = r.decision ? `<p><b>${esc(DECISION_LABEL[r.decision.decision] || r.decision.decision)}.</b> ${esc(r.decision.reasons.join(" "))} <span class="muted">${esc(r.decision.next)}</span></p>` : "";
  const intervals = r.intervals ? `<p>95% intervals: edited ${intervalText(r.intervals.editedPct)}, wild type ${intervalText(r.intervals.wtPct)}, ${hdr ? "HDR score" : "intended edit"} ${intervalText(r.intervals.intendedEditPct)}, frameshift score ${intervalText(r.intervals.koScorePct)}${r.intervals.functionalKoPct ? `, functional KO ${intervalText(r.intervals.functionalKoPct)}` : ""}. ${r.intervals.detected ? "" : `No edit detected; up to ${r.intervals.hiddenUpToPct}% could be present undetected. `}${r.confidence ? `Confidence <b>${esc(r.confidence.tier)}</b> (interval width ${r.confidence.width} points). <span class="muted">${esc(r.confidence.expected)}</span>` : ""}</p>` : "";
  const reads = r.reads && r.reads.length > 1 ? `<table><tr><th>Read</th><th>Orientation</th><th>Edited</th><th>Intended edit</th><th>Positions</th></tr>${r.reads.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.orientation)}</td><td>${x.editedPct}%</td><td>${x.intendedEditPct}%</td><td>${x.positions}</td></tr>`).join("")}</table><p class="muted">The reads were fitted together; ${r.agreement && r.agreement.agree ? "they agree" : "they disagree"} (spread ${r.agreement ? r.agreement.spread.toFixed(1) : "n/a"} points).</p>` : "";
  const baseEdits = r.baseEdits ? `<h3>Base editing: conversion at each position of the window</h3><table><tr><th>Protospacer position</th><th>Change</th><th>Role</th><th>Conversion</th><th>Interval</th></tr>${r.baseEdits.positions.map((p) => `<tr><td>${p.protospacerPosition}</td><td>${esc(p.change)}</td><td>${esc(p.role)}</td>${p.covered ? `<td>${p.conversionPct}%</td><td>${p.intervalPct[0]}-${p.intervalPct[1]}%</td>` : `<td colspan="2" class="muted">${esc(p.reason)}</td>`}</tr>`).join("")}</table>` : "";
  const provenance = r.inputs ? `<p class="muted">Inputs (SHA-256, first 12): ${[...r.inputs.edited.map((f) => `${esc(f.file)} ${f.sha256.slice(0, 12)}`), ...r.inputs.controls.map((f) => `control ${esc(f.file)} ${f.sha256.slice(0, 12)}`)].join("; ")}.</p>` : "";
  const genotype = r.genotype ? `<p><b>Clone call:</b> ${esc(r.genotype.summary)}.</p><ul>${r.genotype.flags.map((f) => `<li class="muted">${esc(f)}</li>`).join("")}</ul>` : "";
  const markers = r.markers.some((m) => m.covered) ? `<h3>Per-position readout of the designed changes</h3><table><tr><th>Position</th><th>Change</th><th>Role</th><th>Donor base in edited</th><th>in control</th><th>Net</th></tr>${r.markers.map((m) => `<tr><td>${m.position}</td><td>${esc(m.change)} ${esc(m.label)}${m.protein ? ` &middot; ${esc(m.protein.label)}${m.protein.silent ? " (silent)" : ""}, ${esc(m.protein.codonFrom)}&gt;${esc(m.protein.codonTo)}` : ""}</td><td>${esc(m.role)}</td>${m.covered ? `<td>${pct(m.altEdited)}</td><td>${pct(m.altControl)}</td><td>${pct(m.altNet)}</td>` : `<td colspan="3" class="muted">${esc(m.reason)}</td>`}</tr>`).join("")}</table>` : "";
  const functional = r.functional ? (() => {
    const f = r.functional; const lofWord = (v) => (v === true ? "yes" : v === false ? "no" : "uncertain");
    const rows = f.rows.filter((x) => x.fraction >= 0.01).map((x) => `<tr><td>${esc(x.label)}</td><td>${pct(x.fraction)}</td><td>${esc(x.summary)}</td><td>${lofWord(x.lof)}</td></tr>`).join("");
    return `<h3>Functional knockout assessment</h3><p><b>${esc(f.call.text)}</b> Functional knockout score ${s.functionalKoPct}%${r.intervals && r.intervals.functionalKoPct ? ` (95% interval ${intervalText(r.intervals.functionalKoPct)})` : ""}, uncertain ${s.functionalUncertainPct}%. Coding sequence of ${esc(f.context.transcript || "")}: ${f.context.proteinLength} residues in ${f.context.codingExons} coding exon${f.context.codingExons === 1 ? "" : "s"}.</p><table><tr><th>Allele</th><th>Share</th><th>Predicted effect on the protein</th><th>Loss of function</th></tr>${rows}</table>${(() => { const fig = cloneProteinFigure(r, { title: "Predicted protein products" }); return fig ? `<div style="overflow-x:auto">${fig}</div>` : ""; })()}<p class="muted">Predicted from sequence only. Nonsense-mediated decay follows the exon-junction rules (stop in the last coding exon, within 55 nt of the last junction, within 150 nt of the start codon, or in a coding exon over 407 nt escapes); these rules fail for roughly a third of premature stops. A knockout is confirmed by loss of protein.</p>${f.caveats.length ? `<ul>${f.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}${f.confirm.length ? `<p><b>To confirm</b></p><ul>${f.confirm.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}`;
  })() : "";
  const q = r.quality;
  const aligned = r.view && chromatogram ? `<h3>Chromatogram aligned with the wild-type control</h3><div style="overflow-x:auto">${cloneAlignedFigure(r.view, { name: r.name, decision: r.decision ? r.decision.decision : "", headline: headline(workflow, r) })}</div>` : "";
  return `${head}${decision}${numbers}${intervals}${reads}${baseEdits}${genotype}${functional}<table><tr><th>Allele</th><th>Type</th><th>Share</th></tr>${contributionRows(r)}</table>${aligned}${r.charts.contributions}${r.charts.discordance}${markers}${provenance}<p class="muted">Fit R&sup2; ${q.r2 === null ? "n/a" : q.r2} (relative to a wild-type-only fit), background signal ${pct(q.noiseFraction)}, ${q.positionsUsed} positions in the window, ${q.columns} distinguishable candidate alleles; mean discordance ${q.discordanceBefore} before the cut${q.discordanceNearCut !== undefined && q.discordanceNearCut !== null ? ` (${q.discordanceNearCut} in the stretch next to it)` : ""}, ${q.discordanceAfter} after it.</p>${r.warnings.length ? `<ul>${r.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join("")}</ul>` : ""}</div>`;
}

const NEXT_EDIT = [
  "Validate: sequence each clone in both directions and read every designed change; a second PCR with primers outside the first pair excludes allelic dropout and a large deletion on one allele. Where a clone carries different silent changes on its two alleles, confirm which allele carries which (clone the amplicon or sequence it deeply). Check the predicted off-target sites of the guides.",
  "Karyotype: SNP array of the clones carried forward and the parental line (copy number, loss of heterozygosity at the edited locus, recurrent gains).",
  "Bank: expand the first-choice clones and freeze several vials of each at low passage from the validated pool; keep one reserve vial of the clone held back.",
  "Quality control: mycoplasma, identity (STR) against the parental line, pluripotency markers, and whole-genome sequencing of the final two or three clones.",
];
const NEXT_KO = [
  "Confirm the knockout at protein level (for example a Western blot with an antibody to a region every product would keep) and read the result back into the run (`--observations`).",
  "Check the other allele: a PCR across the cut sites with primers outside the first pair excludes a large deletion that Sanger cannot see.",
  "Karyotype: SNP array of the clones carried forward and the parental line.",
  "Bank and quality control: freeze several vials at low passage; mycoplasma, identity (STR), pluripotency markers; whole-genome sequencing of the final clones.",
];

/** The clone selection figure and the suggested next steps for the clones carried forward. */
export function selectionSection(results, workflow) {
  const figure = cloneSelectionFigure(results); if (!figure) return "";
  const names = panelOf(results); const steps = workflow === "knockout" || workflow === "deletion" ? NEXT_KO : NEXT_EDIT;
  return `<h2>Clone selection</h2><div style="overflow-x:auto">${figure}</div>${names.length ? `<h3>Next steps for ${esc(names.join(", "))}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p class="muted">Suggested steps; adapt them to your own workflow.</p>` : ""}`;
}

/** The clones of each design on one stretch of the control: the base calls as an alignment, and the chromatograms stacked (up to 48 clones). */
export function alignedSection(results) {
  const groups = alignedGroups(results); if (!groups.length) return "";
  const intro = "<p class=\"muted\">Best clone first. Every clone is laid onto the same stretch of the wild-type control read, base by base. Guides (grey bar, PAM darker), cuts and designed changes are marked. A base that differs from the control is highlighted; a dash is a base the clone lacks.</p>";
  return `<h2>All clones aligned</h2>${intro}${groups.map((items, g) => `${groups.length > 1 ? `<h3>Design group ${g + 1} (${items.length} samples)</h3>` : ""}<h3>Base calls</h3><div style="overflow-x:auto">${clonesAlignmentFigure(items)}</div>${items.length <= 48 ? `<h3>Chromatograms</h3><div style="overflow-x:auto">${clonesAlignedFigure(items)}</div>` : "<p class=\"muted\">More than 48 clones: the chromatograms are in the sample sections below.</p>"}`).join("")}`;
}

export function buildTakeHomeMessage(workflow, results = []) {
  const total = results.length;
  const getDec = (r) => (r.decision?.decision || r.decision?.verdict || "").toLowerCase();
  const accepted = results.filter((r) => getDec(r) === "accept");
  const held = results.filter((r) => getDec(r) === "hold");
  const reseq = results.filter((r) => getDec(r) === "re-sequence");
  const rejected = results.filter((r) => getDec(r) === "reject");
  const isKo = workflow === "knockout" || workflow === "deletion";
  const panelNames = panelOf(results);
  const carryNames = panelNames.length ? panelNames : accepted.slice(0, isKo ? 3 : 6).map((r) => r.name);
  const carryObjects = carryNames.map((n) => results.find((r) => r.name === n)).filter(Boolean);

  const describeClone = (r) => {
    const s = r.summary || {};
    const score = isKo
      ? `${s.functionalKoPct ?? s.koScorePct ?? s.editedPct ?? 0}% KO`
      : `${s.intendedEditPct ?? 0}% HDR`;
    const call = r.genotype?.summary || headline(workflow, r) || score;
    return `${r.name} (${call})`;
  };

  if (carryObjects.length > 0) {
    const rate = Math.round((accepted.length / Math.max(1, total)) * 100);
    return {
      status: "pass",
      headline: `Carry forward for expansion & banking: ${carryNames.join(", ")}`,
      summary: `Out of ${total} screened sample${total === 1 ? "" : "s"}, ${accepted.length} (${rate}%) met acceptance criteria (${held.length} held, ${reseq.length} re-sequence, ${rejected.length} rejected). Top prioritized clone${carryObjects.length === 1 ? "" : "s"}: ${carryObjects.map(describeClone).join("; ")}.`,
      nextStep: isKo
        ? "Next step: Expand prioritized clone(s), freeze low-passage vials, and confirm loss of protein expression (e.g. Western blot) and absence of large monoallelic deletions."
        : "Next step: Expand prioritized clone(s), freeze low-passage vials, and confirm zygosity with bidirectional reads and primers outside the homology arms.",
    };
  }

  if (held.length > 0 || reseq.length > 0) {
    return {
      status: "warn",
      headline: held.length > 0
        ? `Hold / Review: ${held.map((r) => r.name).join(", ")} (no unambiguous top clone yet)`
        : `Re-sequencing required for ${reseq.length} trace${reseq.length === 1 ? "" : "s"}`,
      summary: `Out of ${total} screened sample${total === 1 ? "" : "s"}, 0 met strict acceptance criteria, ${held.length} ${held.length === 1 ? "is" : "are"} held for review (e.g. heterozygous or partial conversion), and ${reseq.length} require re-sequencing.`,
      nextStep: "Next step: Re-sequence traces with low signal quality in both directions, or subclone/screen additional colonies.",
    };
  }

  return {
    status: "fail",
    headline: "No edited clones identified in this cohort",
    summary: `All ${total} screened sample${total === 1 ? "" : "s"} were called wild-type or rejected.`,
    nextStep: "Next step: Screen additional colonies or verify RNP/donor delivery efficiency in the parental pool before picking clones.",
  };
}

export function buildQcReportHtml({ title = "Publication Clone Screening Report", workflow, design = "", results, generatedAt = new Date(), notes = [] }) {
  const flow = WORKFLOWS[workflow]?.label || workflow;
  const takeHome = buildTakeHomeMessage(workflow, results);
  const boxBorder = takeHome.status === "pass" ? "#10b981" : takeHome.status === "warn" ? "#f59e0b" : "#ef4444";
  const boxBg = takeHome.status === "pass" ? "#ecfdf5" : takeHome.status === "warn" ? "#fffbeb" : "#fef2f2";
  const boxTitleColor = takeHome.status === "pass" ? "#065f46" : takeHome.status === "warn" ? "#92400e" : "#991b1b";
  const rows = results.map((r) => `<tr><td>${r.recommendation?.rank ? `#${r.recommendation.rank}` : "—"}</td><td><b>${esc(r.name)}</b></td><td>${r.decision ? esc(DECISION_LABEL[r.decision.decision]) : ""}</td><td class="${statusClass(r)}">${esc(headline(workflow, r))}</td><td>${esc(r.genotype?.summary || "—")}</td><td>${r.ok ? (r.warnings?.length ? `${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"}` : "none") : "not analysed"}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${esc(flow)}${design ? ` &middot; ${esc(design)}` : ""} &middot; ${results.length} sample${results.length === 1 ? "" : "s"} &middot; generated ${esc(generatedAt.toISOString().slice(0, 10))} by Assured QC ${QC_VERSION}</p>
<div style="border:2px solid ${boxBorder};border-left-width:8px;background:${boxBg};border-radius:8px;padding:12px 16px;margin:14px 0;">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${boxTitleColor};margin-bottom:4px;">Final Take-Home Conclusion</div>
  <div style="font-size:16px;font-weight:700;color:${boxTitleColor};margin-bottom:6px;">${esc(takeHome.headline)}</div>
  <div style="font-size:13px;color:#1f2937;margin-bottom:6px;">${esc(takeHome.summary)}</div>
  <div style="font-size:12px;color:#475467;font-weight:600;">${esc(takeHome.nextStep)}</div>
</div>
${notes.map((n) => `<p>${esc(n)}</p>`).join("")}
<h2>1. Clone Screening Summary</h2>${(() => { const fig = runSummaryFigure(results, { title: "Run summary" }); return fig ? `<div style="overflow-x:auto">${fig}</div>` : ""; })()}<table><tr><th>Rank</th><th>Sample / Clone</th><th>Decision</th><th>Result</th><th>Genotype Call</th><th>Notes</th></tr>${rows}</table>
${selectionSection(results, workflow)}
${alignedSection(results)}
<h2>Samples</h2>${results.map((r) => sampleSection(workflow, r, { chromatogram: results.length <= 48 || !r.decision || r.decision.decision !== "reject" })).join("")}
<h2>Method and limits</h2><ul>${METHOD.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
</body></html>`;
}

const csvCell = (value) => { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };

export function buildResultsCsv(workflow, results) {
  const header = ["sample", "well", "decision", "decision_reason", "status", "result", "wild_type_pct", "edited_pct", "edited_lo", "edited_hi", "indel_pct", "between_cuts_pct", "intended_edit_pct", "intended_lo", "intended_hi", "blocking_only_pct", "ko_score_pct", "ko_lo", "ko_hi", "functional_ko_pct", "functional_ko_lo", "functional_ko_hi", "functional_call", "unexplained_pct", "confidence", "clone_call", "reads_used", "reads_agree", "junction_verdict", "fit_r2", "unplanned_changes", "notes", "knockout_support", "priority_rank", "recommendation"];
  const lines = [header.join(",")];
  results.forEach((r) => {
    const s = r.summary || {};
    const iv = r.intervals || {};
    lines.push([r.name, r.well || "", r.decision?.decision || "", (r.decision?.reasons || []).join(" "), r.ok ? "analysed" : "failed", headline(workflow, r), s.wtPct, s.editedPct, iv.editedPct?.[0] ?? "", iv.editedPct?.[1] ?? "", s.indelPct, s.betweenCutsPct, s.intendedEditPct, iv.intendedEditPct?.[0] ?? "", iv.intendedEditPct?.[1] ?? "", s.partialConversionPct, s.koScorePct, iv.koScorePct?.[0] ?? "", iv.koScorePct?.[1] ?? "", s.functionalKoPct ?? "", iv.functionalKoPct?.[0] ?? "", iv.functionalKoPct?.[1] ?? "", r.functional?.call?.status || "", s.unexplainedPct ?? "", r.confidence?.tier || "", r.genotype?.category || "", r.reads ? r.reads.length : (r.ok && r.kind !== "junction" ? 1 : ""), r.agreement ? r.agreement.agree : "", r.verdict?.status || "", r.quality?.r2 ?? "", (r.unplanned || []).map((h) => `${h.relative}:${h.change}(${Math.round(h.fraction * 100)}%)`).join(" "), (r.warnings || []).concat(r.ok ? [] : [r.error]).join(" | "), r.recommendation?.score ?? "", r.recommendation?.rank ?? "", r.recommendation?.action || ""].map(csvCell).join(","));
  });
  return `${lines.join("\n")}\n`;
}
