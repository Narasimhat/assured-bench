import { generateGenomicCandidates, genomicReference } from "./genomicDonorCandidates.js";
import { normalizeGenBankToTranscriptModel } from "../engine/design/transcriptModel.js";
import { parseGB } from "../engine/design/designEngine.js";
import { runDesignFromTranscriptModel, summarizeProcurementReadiness, assemblePointMutationPairs } from "../engine/design/designEngine.js";
import { findSpCas9Guides } from "../engine/design/transcriptModel.js";
import { withoutRunOverrides } from "./runOptions.js";
import { resolveAlphaGenomeMapping, buildAlphaGenomeRequest, reviewRequestId } from "./alphaGenomeReview.js";

export const CANDIDATE_SCHEMA = "assured-donor-candidates/1";
export function donorSourceSnapshot(project) {
  return JSON.stringify({ generator: "matched-substitution/2", reference: project.designResult?.type === "genomic-snv" ? genomicReference(project) : project.genbankRaw, genomicInput: project.designResult?.type === "genomic-snv" ? project.genomicDesignInput?.input || project.designResult.input : undefined, mutation: project.mutation, gene: project.gene,
    options: withoutRunOverrides(project.options), type: project.designResult?.type }, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
}
export async function donorSourceId(project) { return reviewRequestId(JSON.parse(donorSourceSnapshot(project))); }

/** Each result is built independently: blockers from another alternative are never pooled. */
export async function generateDonorCandidates(project, previous = null) {
  const base = project.designResult;
  if (base?.type === "genomic-snv") return { schema: CANDIDATE_SCHEMA, ...(await generateGenomicCandidates(project, previous, donorSourceId)), sourceSnapshot: donorSourceSnapshot(project) };
  if (base?.type !== "pm" || (project.options?.enzyme && project.options.enzyme !== "spcas9")) throw new Error("Matched candidate comparison currently supports SpCas9 point mutations with a coding reference.");
  const sourceId = await donorSourceId(project);
  if (previous && previous.sourceId !== sourceId) throw new Error("The reference or design settings changed. Generate a fresh candidate panel.");
  const model = base.gb;
  const options = { ...withoutRunOverrides(project.options), enzyme: "spcas9", expectedGene: project.gene, ensureGuidePair: false, coDeliveryBlocking: false,
    acceptWeakProtection: false, weakProtectionReason: "", weakProtectionAcceptance: null };
  const guides = findSpCas9Guides(model, null, base.gp, 30)
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.sp.localeCompare(b.sp));
  let candidates = previous ? [...previous.candidates] : [];
  const seen = new Set(candidates.map(c => `${c.result.gs[0].sp}:${c.result.os[0].od}`));
  const attempts = [];
  const retainedBaselines = project.donorCandidatePanel?.sourceId === sourceId ? project.donorCandidatePanel.candidates.filter(c => c.baseline) : [];
  if (!previous && retainedBaselines.length === 2) {
    for (const candidate of retainedBaselines) {
      candidates.push({ ...candidate, id: `pair-${candidates.length + 1}`, round: 1 });
      seen.add(`${candidate.result.gs[0].sp}:${candidate.result.os[0].od}`);
    }
  } else if (!previous && base.gs.length === 2 && base.os.length === 2) {
    for (let i = 0; i < base.os.length; i++) {
      const result = assemblePointMutationPairs([{ result: base, donorIndex: i }]);
      const eligible = !result.procurement.blockers.length && result.os[0].guideProtection[0].tier === "strong";
      const key = `${result.gs[0].sp}:${result.os[0].od}`; seen.add(key);
      candidates.push({ id: `pair-${candidates.length + 1}`, round: 1, baseline: true, result, eligible, reservedBlockerPositions: [], blockers: result.ss.length,
        protection: result.os[0].guideProtection[0].tier, reasons: [...result.procurement.blockers, ...result.procurement.warnings] });
    }
  }
  const add = (guide, reserved = []) => {
    if (candidates.length >= (previous ? 12 : 24)) return;
    const result = runDesignFromTranscriptModel("pm", model, project.mutation, "", null, { ...options, customGuides: [guide.sp], reservedBlockerPositions: reserved });
    if (result.err || result.os?.length !== 1) { attempts.push({ spacer: guide.sp, reason: result.err || "No matched donor" }); return; }
    const key = `${result.gs[0].sp}:${result.os[0].od}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.guideDonorInstruction = "Use this single guide with its matched ssODN. Other candidate pairs are separate alternatives and must not be pooled.";
    result.procurement = summarizeProcurementReadiness(result);
    const eligible = !result.procurement.blockers?.length && result.os[0].proteinValidation?.valid === true && result.os[0].guideProtection?.[0]?.tier === "strong";
    candidates.push({ id: `pair-${candidates.length + 1}`, round: previous ? 2 : 1, result, eligible,
      reservedBlockerPositions: reserved, blockers: result.ss.length, protection: result.os[0].guideProtection?.[0]?.tier || "unknown",
      reasons: [...(result.procurement.blockers || []), ...(result.procurement.warnings || []), ...(!eligible ? ["Strong matched-guide protection and a valid final protein are required for a preference."] : [])] });
  };
  // Round one prioritizes distinct guides. Round two explores different synonymous blocker sets.
  if (!previous) {
    for (const guide of guides) {
      if (candidates.some(c => c.result.gs[0].sp === guide.sp)) continue;
      await new Promise(resolve => setTimeout(resolve, 0));
      add(guide);
      if (candidates.filter(c => c.eligible).length >= 6) break;
    }
    candidates = [...candidates.filter(c => c.baseline), ...candidates.filter(c => !c.baseline && c.eligible), ...candidates.filter(c => !c.baseline && !c.eligible)].slice(0, 6).map((c, i) => ({ ...c, id: `pair-${i + 1}` }));
  }
  const parents = previous?.candidates || [...candidates];
  for (const parent of parents) for (const blocker of parent.result.ss) {
    if (!previous && candidates.length >= 6) break;
    await new Promise(resolve => setTimeout(resolve, 0));
    add(parent.result.gs[0], [...parent.reservedBlockerPositions, blocker.gp]);
  }
  return { schema: CANDIDATE_SCHEMA, sourceId, sourceSnapshot: donorSourceSnapshot(project), candidates, attempts, rounds: previous ? 2 : 1, createdAt: new Date().toISOString(),
    note: "Alternatives are separate guide–donor pairs. Genome-wide specificity remains an external check. No candidate is certified safe." };
}

export async function buildDonorComparisonRequest(project, panel, { ontologyTerm, sequenceLength = 16384 }) {
  if (panel.sourceId !== await donorSourceId(project)) throw new Error("Candidate panel is stale. Generate candidates again.");
  const mapping = await resolveAlphaGenomeMapping(project);
  if (!mapping || mapping.assembly !== "GRCh38") throw new Error("A human GRCh38 reference with chromosome, start and orientation annotation is required. Use a mapped Ensembl reference.");
  const candidates = [];
  for (const candidate of panel.candidates) {
    const request = await buildAlphaGenomeRequest({ ...project, designResult: candidate.result }, { ...mapping, ontologyTerm, sequenceLength, mappingConfirmed: true });
    candidates.push({ id: candidate.id, request });
  }
  const reference = candidates[0]?.request.reference;
  if (!reference) throw new Error("No candidate donors could be generated for this locus.");
  const model = project.designResult.type === "genomic-snv" ? normalizeGenBankToTranscriptModel(parseGB(genomicReference(project)), { expectedGene: project.gene }) : panel.candidates[0].result.gb;
  if (!model) throw new Error("Transcript annotation is required for a complete genomic SNP comparison. Individual allele review remains available under Analysis & evidence.");
  const toGenome = (start, end) => mapping.orientation === 1
    ? [mapping.referenceStart - 1 + start, mapping.referenceStart - 1 + end]
    : [mapping.referenceStart - 1 + reference.sequence.length - end, mapping.referenceStart - 1 + reference.sequence.length - start];
  const exons = model.exons?.length ? model.exons.map(e => toGenome(e.start, e.end)) : [];
  if (!exons.length) throw new Error("Exon annotations are required for transcript-localized comparison.");
  // Internal exon boundaries only. Transcript ends are not splice sites.
  const sorted = [...exons].sort((a, b) => a[0] - b[0]);
  const splicePositions = sorted.slice(0, -1).flatMap((e, i) => [e[1], sorted[i + 1][0]]);
  const payload = { schema: "assured-alphagenome-comparison-request/1", sourceId: panel.sourceId,
    annotation: { transcript: model.transcriptId, strand: model.strand * mapping.orientation, exons, splicePositions, convention: "0-based half-open" }, candidates };
  return { ...payload, requestId: await reviewRequestId(payload) };
}

export function comparisonCoversAnnotation(batch) {
  const request = batch.candidates[0].request;
  const intended = request.variants.filter(v => v.role === "intended").map(v => v.position - 1);
  const start = Math.max(0, Math.floor((Math.min(...intended) + Math.max(...intended)) / 2) - request.sequenceLength / 2);
  const end = start + request.sequenceLength;
  return batch.annotation.exons.every(([a, b]) => start <= a && b <= end)
    && batch.annotation.splicePositions.every(p => start <= p - 2 && p + 2 <= end);
}

export async function buildCoveredDonorComparisonRequest(project, panel, options) {
  let batch = await buildDonorComparisonRequest(project, panel, options);
  if (!comparisonCoversAnnotation(batch) && options.sequenceLength !== 131072) batch = await buildDonorComparisonRequest(project, panel, { ...options, sequenceLength: 131072 });
  if (!comparisonCoversAnnotation(batch)) throw new Error("The annotated transcript extends beyond the largest supported comparison window. A complete transcript-based preference cannot be calculated for this reference.");
  return batch;
}

/** Compare like-for-like axes using Pareto dominance, never a fabricated harmful/safe cutoff. */
export function rankDonorCandidates(panel, report) {
  const rows = panel.candidates.map(candidate => {
    const review = report?.candidates?.find(r => r.id === candidate.id);
    const metrics = review?.status === "complete" ? review.metrics : null;
    const complete = metrics && [metrics.exonicRnaRelativeDelta, metrics.annotatedUsageMaxDelta, metrics.spliceSiteMaxDelta].every(n => Number.isFinite(n) && n >= 0);
    return { ...candidate, review, metrics, reviewed: Boolean(complete), preferred: false };
  });
  const eligible = rows.filter(r => r.eligible && r.reviewed);
  const axes = ["exonicRnaRelativeDelta", "annotatedUsageMaxDelta", "spliceSiteMaxDelta"];
  const dominates = (a, b) => axes.every(k => a.metrics[k] <= b.metrics[k] + 1e-9) && axes.some(k => a.metrics[k] < b.metrics[k] - 1e-9);
  const frontier = eligible.filter(row => !eligible.some(other => dominates(other, row)));
  const allReviewed = rows.length > 1 && rows.every(r => r.reviewed);
  const tied = frontier.length > 1 && frontier.every(r => axes.every(k => Math.abs(r.metrics[k] - frontier[0].metrics[k]) <= 1e-9));
  for (const row of rows) row.preferred = allReviewed && frontier.includes(row);
  // An explicit engineering preference within the frontier, not a safety threshold.
  const preferredOrder = ["annotatedUsageMaxDelta", "exonicRnaRelativeDelta", "spliceSiteMaxDelta"];
  const suggested = [...frontier].sort((a, b) => {
    for (const key of preferredOrder) { const delta = a.metrics[key] - b.metrics[key]; if (Math.abs(delta) > 1e-9) return delta; }
    return (a.blockers || 0) - (b.blockers || 0) || Math.abs(a.result?.gs?.[0]?.d || 0) - Math.abs(b.result?.gs?.[0]?.d || 0) || a.id.localeCompare(b.id);
  })[0];
  return { rows, suggestedId: allReviewed ? suggested?.id || null : null, preferencePolicy: "Within the comparative frontier: lower annotated splice-usage change, then exonic RNA disturbance, then splice-site disturbance; ties use fewer blockers and closer cuts. Exploratory priorities, not safety thresholds.", frontier: allReviewed ? frontier.map(r => r.id) : [], status: !allReviewed ? "Review incomplete" : !frontier.length ? "Redesign or further review needed" : frontier.length === 1 ? "Preferred for experimental validation" : tied ? "Equally supported alternatives" : "Trade-offs need review",
    message: !allReviewed ? "No preference until all candidates have comparable evidence; failed or missing outputs are not a clean result."
      : frontier.length === 1 ? "This candidate has no larger predicted blocker-associated change on any comparison axis and improves at least one axis relative to each dominated candidate. Specificity and experimental validation remain open."
      : tied ? "These alternatives are tied on the comparison axes. Choose using guide specificity and experimental suitability; no regulatory winner is established." : "Several candidates have different strengths. No single regulatory winner is established. Compare the evidence before selecting a pair." };
}

export async function validateDonorComparison(report, batch) {
  if (report?.schema !== "assured-alphagenome-comparison/1" || report.requestId !== batch.requestId || report.sourceId !== batch.sourceId || !Array.isArray(report.candidates) || report.candidates.length !== batch.candidates.length) throw new Error("This comparison does not match the current candidates, cell context and reference. Import the completed comparison JSON for this panel.");
  if (report.modelVersion !== "ALL_FOLDS" || typeof report.sdkVersion !== "string" || JSON.stringify(report.ontologyTerms) !== JSON.stringify(batch.candidates[0].request.ontologyTerms) || await reviewRequestId(report.annotation) !== await reviewRequestId(batch.annotation)) throw new Error("Comparison model, annotation or cell context does not match this request.");
  const req = batch.candidates[0].request;
  const intended = req.variants.filter(v => v.role === "intended").map(v => v.position - 1);
  const start = Math.max(0, Math.floor((Math.min(...intended) + Math.max(...intended)) / 2) - req.sequenceLength / 2);
  if (report.context?.start !== start || report.context?.end !== start + req.sequenceLength) throw new Error("Comparison interval does not match the common intended-edit window.");
  if (new Set(report.candidates.map(c => c.id)).size !== report.candidates.length) throw new Error("Duplicate comparison candidates.");
  for (const candidate of batch.candidates) {
    const actual = report.candidates.find(c => c.id === candidate.id);
    if (!actual || actual.requestId !== candidate.request.requestId || !["complete", "failed"].includes(actual.status)) throw new Error("Candidate review identity is missing or stale.");
    if (actual.status === "complete") {
      if (!actual.metrics || !Array.isArray(actual.localizedTracks) || !actual.localizedTracks.length) throw new Error("Position-resolved evidence is missing.");
      for (const k of ["exonicRnaRelativeDelta", "annotatedUsageMaxDelta", "spliceSiteMaxDelta"]) {
        const value = actual.metrics[k];
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("Comparison metrics are invalid.");
      }
      if (!["RNA_SEQ", "SPLICE_SITE_USAGE", "SPLICE_SITES"].every(output => actual.localizedTracks.some(t => t.output === output))) throw new Error("A requested expression or splicing output is missing.");
      for (const track of actual.localizedTracks) {
        if (!Array.isArray(track.topChanges) || !track.topChanges.length || track.topChanges.length > 5 || track.topChanges.some(x => !Number.isSafeInteger(x.position) || ![x.before, x.after, x.delta].every(Number.isFinite))) throw new Error("Localized prediction values are invalid.");
      }
    }
  }
  return report;
}
