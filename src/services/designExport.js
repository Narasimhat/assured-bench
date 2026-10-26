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
  const withBiomni = appendBiomniSummary(html, project?.biomniReport, designResult);
  return appendWorkflowRecommendation(withBiomni, designResult.workflowRecommendation);
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
      `<p style="margin:4px 0"><strong>Pan-Isoform Target Exon:</strong> Coding Exon ${escapeHtml(panMeta.targetCodingExon)} — shared across <strong>${escapeHtml(panMeta.sharedIsoforms)}/${escapeHtml(panMeta.totalIsoforms)} (${escapeHtml(panMeta.coveragePct)}%)</strong> protein-coding isoforms (${panMeta.isCommonExon ? "✓ NMD-Safe Common Exon" : panMeta.isTerminalExon ? "⚠ Terminal Exon" : "⚠ Partial/Escape Exon"}).</p>`
    );
  } else if (iso?.ok) {
    lines.push(
      `<p style="margin:4px 0"><strong>Isoform Exon Architecture:</strong> Evaluated ${escapeHtml(iso.codingExonCount)} coding exons across ${escapeHtml(iso.isoformCount)} protein-coding isoforms (${escapeHtml(iso.source)}); NMD-safe common KO exons: ${escapeHtml((iso.recommendedCommonKoExons || []).map(n => `Exon ${n}`).join(", ") || "none")}.</p>`
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
          ? `${matched.length} selected guide(s) directly match Brunello whole-genome library (${escapeHtml(matched.map(m => `${m.spacer} [Brunello #${m.brunelloRank}]`).join(", "))}).`
          : `Evaluated ${brunello.length} Brunello reference guides (${escapeHtml(brunello.map(b => `${b.spacer} [Exon ${b.exon}, ${b.panelTier}]`).join("; "))}).`
      }</p>`
    );
  }
  if (rescue?.isNmdBlindLocus) {
    lines.push(
      `<p style="margin:4px 0;color:#92400e"><strong>NMD-Escape Locus Rescue:</strong> ${escapeHtml(rescue.reason)} Use dual-guide excision or 5′ terminal-exon early truncation (&lt;50% retained CDS).</p>`
    );
  }
  if (sp?.ok) {
    lines.push(
      `<p style="margin:4px 0"><strong>Clonal Screening Power (${escapeHtml(sp.mode)}):</strong> Predicted biallelic clone yield ~<strong>${escapeHtml(sp.predictedBiallelicClonePct)}%</strong> → Screen <strong>${escapeHtml(sp.recommendedClonesToScreen)} clones</strong> (${escapeHtml(sp.plates96Well)} × 96-well plate) for ≥95% probability of recovering ≥2 verified clones.</p>`
    );
  }
  if (!lines.length) return html;
  const section = `<section style="margin:16px 20px;padding:12px 16px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;color:#0f172a"><div style="font-weight:700;color:#0369a1;margin-bottom:4px">🧬 ASSURED-Biomni Co-Scientist Integrated Verification</div>${lines.join("")}</section>`;
  return html.replace(/<body[^>]*>/i, body => body + section);
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
export function downloadReportHtml(project, designResult) {
  const html = generateReportHtml(project, designResult);
  if (!html) return;
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
