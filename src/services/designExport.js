/**
 * Design Exporter Service
 * Exports HTML reports, structured design JSON, and standalone SVG schematics.
 */

import { buildReportHtml, getProjectTypeMeta } from "../engine/design/reportHtml.js";
import { buildRowMeta, buildHistoricalContext, buildReviewItems } from "../engine/design/reportInputs.js";
import { buildQcDesignSpec } from "../engine/design/qcExport.js";
import { buildDesignSchemeSvg } from "../engine/design/designScheme.js";
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

  return buildReportHtml(
    meta,
    designResult,
    fileName,
    historicalContext,
    reviewItems,
    null
  );
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
