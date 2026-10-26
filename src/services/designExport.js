/**
 * Design Exporter Service
 * Exports HTML reports, structured design JSON, and standalone SVG schematics.
 */

import { buildReportHtml, getProjectTypeMeta } from "../engine/design/reportHtml.js";
import { buildRowMeta, buildHistoricalContext, buildReviewItems } from "../engine/design/reportInputs.js";
import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { buildDesignSchemeSvg } from "../engine/design/designScheme.js";
import { agentEvidenceGaps, isAgentAudit } from "./workflowAgent.js";
import { buildGenomicSnpReport } from "../engine/design/genomicSnp.js";
import { describeViability } from "./geneViability.js";
import { describeCutCoverage } from "./isoformCoverage.js";
import { buildCasOffinderInput } from "./offTargetExport.js";
import { exonLabel, exonListLabel, exonOffset } from "./exonLabels.js";
import { buildTakeHome } from "./takeHome.js";

/**
 * Generate full standalone HTML report string
 */
export function generateReportHtml(project, designResult) {
  if (!designResult) return "";
  if (designResult.type === "genomic-snv" && Array.isArray(designResult.candidates)) {
    return appendWorkflowRecommendation(buildGenomicSnpReport(designResult), designResult.workflowRecommendation);
  }

  const projectType = project.editType || designResult.type || "ko";
  const fileName = `${project.gene || "gene"}_reference.gb`;
  const row = {
    projectType,
    fileName,
    gene: project.gene || designResult.gene,
    mutation: project.mutation || "",
    tag: project.tag || "",
    extra: {
      design_options: project.options || {}
    }
  };

  const meta = buildRowMeta(row, designResult);
  const historicalContext = buildHistoricalContext(meta, designResult, projectType);
  const reviewItems = buildReviewItems(meta, designResult, fileName);

  const html = buildReportHtml(
    meta,
    designResult,
    fileName,
    historicalContext,
    reviewItems,
    null
  );
  const takeHome = buildTakeHome({ designResult, biomniReport: project?.biomniReport || null });
  const withTakeHome = html.replace("<!--TAKEHOME-->", takeHome ? renderTakeHomeHtml(takeHome) : "");
  const withBiomni = appendBiomniSummary(withTakeHome, project?.biomniReport, designResult);
  return appendWorkflowRecommendation(withBiomni, designResult.workflowRecommendation);
}

/** The take-home as the first block of the report: status, what was designed, the bottom line, four numbers, what to watch, what to do next. */
export function renderTakeHomeHtml(t) {
  if (!t) return "";
  const pill = t.status.tone === "ok" ? " ok" : t.status.tone === "bad" ? " bad" : "";
  const border = t.status.tone === "ok" ? "#166534" : t.status.tone === "bad" ? "#991b1b" : "#b45309";
  const facts = t.facts.map((f) => `<td><span class="lab">${escapeHtml(f.label)}</span><span class="val">${escapeHtml(f.value)}</span>${f.note ? `<span class="note2">${escapeHtml(f.note)}</span>` : ""}</td>`);
  const rows = []; for (let i = 0; i < facts.length; i += 2) rows.push(`<tr>${facts[i]}${facts[i + 1] || "<td></td>"}</tr>`);
  return `<section class="th" style="border-left-color:${border}"><span class="pill${pill}">${escapeHtml(t.status.label)}</span> <span class="meta">${escapeHtml(t.status.detail || "")}</span>
    <h2>${escapeHtml(t.headline)}</h2><p class="bottom">${escapeHtml(t.bottomLine)}</p>
    <table class="facts">${rows.join("")}</table>
    ${t.watch.length ? `<h3>Watch</h3><ul>${t.watch.map((w) => `<li>${escapeHtml(w.text)}</li>`).join("")}</ul>${t.watchMore ? `<p class="sub">${t.watchMore} more under the details below.</p>` : ""}` : ""}
    <h3>Next</h3><ol>${t.nextSteps.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol></section>`;
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function appendBiomniSummary(html, biomniReport, designResult) {
  const panMeta = designResult?.panIsoformMeta;
  if (!biomniReport && !panMeta) return html;
  const iso = biomniReport?.isoformAnalysis;
  const sp = biomniReport?.screeningPower;
  const brunello = biomniReport?.lindelRanking?.brunelloComparison || [];
  const rescue = biomniReport?.lindelRanking?.nmdEscapeRescue;
  const upg = designResult?.singleCdsDefault || panMeta?.singleCdsDefault;

  const lines = [];
  if (panMeta) {
    lines.push(
      `<p style="margin:4px 0"><strong>Exon-level isoform sharing:</strong> ${escapeHtml(exonLabel(panMeta.targetCodingExon, Number.isFinite(panMeta.transcriptExon) ? panMeta.transcriptExon - panMeta.targetCodingExon : null))} is present in ${escapeHtml(panMeta.sharedIsoforms)} of ${escapeHtml(panMeta.totalIsoforms)} RefSeq coding isoforms in the reference used (${panMeta.isCommonExon ? "an exon shared by all of them" : panMeta.isTerminalExon ? "terminal exon: nonsense-mediated decay is not expected" : "not shared by all of them"}). This is a property of the exon; whether each guide cuts inside every annotated transcript is listed separately below.</p>`
    );
  } else if (iso?.ok) {
    lines.push(
      `<p style="margin:4px 0"><strong>Isoform Exon Architecture:</strong> Evaluated ${escapeHtml(iso.codingExonCount)} coding exons across ${escapeHtml(iso.isoformCount)} protein-coding isoforms (${escapeHtml(iso.source)}); NMD-safe common KO exons: ${escapeHtml(exonListLabel(iso.recommendedCommonKoExons, exonOffset(designResult)) || "none")}.</p>`
    );
  }
  if (upg) {
    lines.push(
      `<p style="margin:4px 0;color:#0369a1"><strong>Biomni Pan-Isoform Upgrade Applied:</strong> Single-transcript default selected ${escapeHtml(upg.exon)} (${escapeHtml((upg.guides || []).join(" + "))}); automatically upgraded to pan-isoform NMD-safe ${escapeHtml(designResult?.exon || "")}.</p>`
    );
  }
  if (brunello.length > 0) {
    const matched = brunello.filter(b => b.selectedInAssuredPair);
    lines.push(
      `<p style="margin:4px 0"><strong>Broad GPP Brunello Library (Addgene #73178) Cross-Reference:</strong> ${
        matched.length > 0
          ? `${matched.length} selected guide(s) directly match Brunello library guides (${escapeHtml(matched.map(m => `${m.spacer} [Brunello #${m.brunelloRank}]`).join(", "))}).`
          : `Evaluated ${brunello.length} Brunello reference guides (${escapeHtml(brunello.map(b => `${b.spacer} [library exon ${b.exon}, ${b.panelTier}]`).join("; "))}).`
      }</p>`
    );
  }
  if (rescue?.isNmdBlindLocus) {
    lines.push(
      `<p style="margin:4px 0;color:#92400e"><strong>NMD-Escape Locus Rescue:</strong> ${escapeHtml(rescue.reason)} Use dual-guide excision or 5′ terminal-exon early truncation (&lt;50% retained CDS).</p>`
    );
  }
  if (biomniReport?.viability) {
    lines.push(`<p style="margin:4px 0"><strong>Gene constraint and essentiality:</strong> ${escapeHtml(describeViability(biomniReport.viability))}</p>`);
  }
  if (biomniReport?.cutCoverage) {
    const cc = biomniReport.cutCoverage;
    lines.push(`<p style="margin:4px 0"><strong>Transcripts that contain each cut:</strong> ${describeCutCoverage(cc).map(escapeHtml).join("<br>")}${cc.ok && cc.basis ? `<br>Genomic position of the cuts: ${escapeHtml(cc.basis)}.` : ""}${cc.ok && cc.notes?.length ? `<br>${escapeHtml(cc.notes.join(" "))}` : ""}</p>`);
  }
  if (designResult?.pairChangedByIsoformEvidence) {
    const c = designResult.pairChangedByIsoformEvidence; const pct = list => (Array.isArray(list) && list.every(Number.isFinite) ? ` (cuts in ${list.map(x => `${x}%`).join(" and ")} of the annotated transcripts)` : "");
    lines.push(`<p style="margin:4px 0"><strong>Pair changed by transcript evidence:</strong> without it the selector chose ${escapeHtml((c.before || []).join(" + "))}${escapeHtml(pct(c.beforeIsoformCoveragePct))}${c.beforeMinLofPct != null ? `, weaker-guide predicted loss of function ${escapeHtml(c.beforeMinLofPct)}%` : ""}; with it, ${escapeHtml((c.after || []).join(" + "))}${escapeHtml(pct(c.afterIsoformCoveragePct))}${c.afterMinLofPct != null ? `, ${escapeHtml(c.afterMinLofPct)}%` : ""}. ${escapeHtml(c.reason || "")}</p>`);
  }
  if (biomniReport?.variantScreen?.ok) {
    lines.push(
      `<p style="margin:4px 0"><strong>Known population variants (${escapeHtml(biomniReport.variantScreen.source || "dbSNP")}):</strong> ${escapeHtml(biomniReport.variantScreen.summary)}</p>`
    );
  }
  if (biomniReport?.genotypingAssay?.ok) {
    const ga = biomniReport.genotypingAssay;
    lines.push(
      `<p style="margin:4px 0"><strong>Wet-Lab Pre-Sequencing Genotyping Assay (${escapeHtml(ga.assayType)}):</strong> ${
        ga.deletionBp != null
          ? `WT amplicon ${escapeHtml(ga.wtAmpliconBp)} bp → Excised KO amplicon ${escapeHtml(ga.editedAmpliconBp)} bp (Δ${escapeHtml(ga.deletionBp)} bp, ${escapeHtml(ga.relativeChangePct)}% of the amplicon). ${escapeHtml(ga.sizeNote)}`
          : `WT amplicon ${escapeHtml(ga.wtAmpliconBp)} bp${ga.rflpGained?.length ? ` · RFLP gained: ${escapeHtml(ga.rflpGained.join(", "))}` : ""}${ga.rflpLost?.length ? ` · RFLP ablated: ${escapeHtml(ga.rflpLost.join(", "))}` : ""}.`
      }</p>`
    );
  }
  if (sp?.ok) {
    lines.push(
      `<p style="margin:4px 0"><strong>Clonal screening estimate (${escapeHtml(sp.mode)}):</strong> ~<strong>${escapeHtml(sp.predictedBiallelicClonePct)}%</strong> of clones biallelic LoF (${escapeHtml(sp.model)}) → ${sp.recommendedClonesToScreen != null ? `screen <strong>${escapeHtml(sp.recommendedClonesToScreen)} clones</strong> (${escapeHtml(sp.plates96Well)} × 96-well plate) for ≥95% probability of ≥2 such clones` : escapeHtml(sp.note)}. Assumptions: ${sp.assumptions.map(escapeHtml).join(" ")}</p>`
    );
  } else if (sp && sp.ok === false) {
    lines.push(`<p style="margin:4px 0"><strong>Clonal screening estimate:</strong> ${escapeHtml(sp.reason)}</p>`);
  }
  if (!lines.length) return html.replace("<!--EVIDENCE-->", "");
  const section = `<details class="fold"><summary>Co-Scientist checks: isoforms, gene constraint, variants, library, screening</summary><div class="body" style="font-size:13px">${lines.join("")}</div></details>`;
  return html.includes("<!--EVIDENCE-->") ? html.replace("<!--EVIDENCE-->", () => section) : html.replace(/<body[^>]*>/i, body => body + section);
}
export function appendWorkflowRecommendation(html, audit) {
  if (!isAgentAudit(audit)) return html;
  const selected = audit.candidates.find(c => c.enzyme === audit.selectedEnzyme);
  const section = `<section style="margin:20px;padding:16px;border:1px solid #cbd5e1;border-radius:8px"><h2>Workflow agent recommendation for design review</h2>
    <p><strong>Recommended for design review:</strong> ${escapeHtml(audit.candidates.filter(c => c.recommended).map(c => c.name).join(", ") || "No supported option")}.</p>
    ${audit.candidates.filter(c => c.recommended).length > 1 ? "<p>These options are tied on the recorded design criteria.</p>" : ""}
    <p>Applied enzyme: ${escapeHtml(selected?.name || audit.selectedEnzyme)}. Rule-based comparison; no experimental efficiency prediction.</p>
    <p>Agent ${escapeHtml(audit.agentVersion)}; config ${escapeHtml(audit.configVersion)}; priority ${escapeHtml(audit.priority)}; ${escapeHtml(audit.createdAt)}.</p>
    <ul>${(selected?.reasons || []).map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
    <h3>Evidence still needed</h3><ul>${agentEvidenceGaps(audit).map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
    <p>Reference SHA-256: ${escapeHtml(audit.referenceSha256)}; input SHA-256: ${escapeHtml(audit.inputSha256)}.</p>
    <ul>${audit.limitations.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul></section>`;
  return html.replace(/<body[^>]*>/i, body => body + section);
}

/**
 * Download HTML report
 */
// the folds are closed on screen; the downloaded file opens them all when printed or saved as PDF (the in-app preview is sandboxed and has no scripts)
const PRINT_OPENS_FOLDS = "<script>window.addEventListener('beforeprint',function(){document.querySelectorAll('details').forEach(function(d){d.setAttribute('data-was-open',d.open?'1':'0');d.open=true;});});window.addEventListener('afterprint',function(){document.querySelectorAll('details').forEach(function(d){d.open=d.getAttribute('data-was-open')==='1';});});</script>\n";
export function withPrintOpeningFolds(html) { return html.includes("</body>") ? html.replace("</body>", () => `${PRINT_OPENS_FOLDS}</body>`) : html; }

export function downloadReportHtml(project, designResult) {
  const generated = generateReportHtml(project, designResult);
  if (!generated) return;
  const html = withPrintOpeningFolds(generated);
  const gene = (project.gene || "design").toLowerCase();
  downloadBlob(html, `${gene}_${project.editType || "edit"}_report.html`, "text/html;charset=utf-8;");
}

/**
 * Download design JSON (for Assured QC or downstream automation)
 */
export function downloadDesignJson(project, designResult) {
  let jsonContent;
  try {
    jsonContent = buildQcDesignSpec(designResult);
  } catch {
    jsonContent = {
      gene: project.gene,
      editType: project.editType,
      mutation: project.mutation,
      result: designResult
    };
  }

  if (jsonContent.design && isAgentAudit(designResult.workflowRecommendation)) {
    jsonContent.design.workflowRecommendation = designResult.workflowRecommendation;
  }
  const gene = (project.gene || "design").toLowerCase();
  downloadBlob(JSON.stringify(jsonContent, null, 2), `${gene}_${project.editType || "edit"}_design.json`, "application/json");
}

/**
 * Download the Cas-OFFinder input for the design's guides (the off-target search itself is run outside Bench). Returns the build result.
 */
export function downloadCasOffinderInput(project, designResult) {
  const built = buildCasOffinderInput(designResult);
  if (!built.ok) return built;
  const gene = (project.gene || "design").toLowerCase();
  downloadBlob(built.text, `${gene}_cas-offinder_input.txt`, "text/plain;charset=utf-8;");
  return built;
}

/**
 * Download standalone SVG locus schematic
 */
export function downloadSchemeSvg(project, svgContent) {
  const svg = svgContent || buildDesignSchemeSvg(project.designResult);
  if (!svg) return;
  const gene = (project.gene || "design").toLowerCase();
  downloadBlob(svg, `${gene}_locus_scheme.svg`, "image/svg+xml");
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
