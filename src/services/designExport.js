/**
 * Design Exporter Service
 * Exports HTML reports, structured design JSON, and standalone SVG schematics.
 */

import { buildReportHtml, getProjectTypeMeta } from "../engine/design/reportHtml.js";
import { buildRowMeta, buildHistoricalContext, buildReviewItems } from "../engine/design/reportInputs.js";
import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { buildDesignSchemeSvg } from "../engine/design/designScheme.js";
import { isAgentAudit } from "./workflowAgent.js";
import { buildGenomicSnpReport } from "../engine/design/genomicSnp.js";

/**
 * Generate full standalone HTML report string
 */
export function generateReportHtml(project, designResult) {
  if (!designResult) return "";
  if (designResult.type === "genomic-snv" && Array.isArray(designResult.candidates)) {
    return buildGenomicSnpReport(designResult);
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
  return appendWorkflowRecommendation(html, designResult.workflowRecommendation);
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function appendWorkflowRecommendation(html, audit) {
  if (!isAgentAudit(audit)) return html;
  const selected = audit.candidates.find(c => c.enzyme === audit.selectedEnzyme);
  const section = `<section style="margin:20px;padding:16px;border:1px solid #cbd5e1;border-radius:8px"><h2>Workflow agent recommendation</h2>
    <p>Applied enzyme: ${escapeHtml(selected?.name || audit.selectedEnzyme)}. Rule-based comparison; no experimental efficiency prediction.</p>
    <p>Agent ${escapeHtml(audit.agentVersion)}; config ${escapeHtml(audit.configVersion)}; priority ${escapeHtml(audit.priority)}; ${escapeHtml(audit.createdAt)}.</p>
    <ul>${(selected?.reasons || []).map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
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
