/**
 * Regulatory evidence for a point-mutation candidate set, and the decision rule that uses it.
 *
 * AlphaGenome (run offline with tools/alphagenome/rank.py) compares each candidate's donor allele
 * with the intended-edit-only allele inside the annotated gene, and the same comparison is made for
 * random synonymous blocker sets of the same size (the null). Here:
 * - buildCandidateRankingRequest turns a candidate set into the request file rank.py reads;
 * - validateRankingReport checks the report that comes back;
 * - rankCandidates applies a fixed rule. Stage-1 tiers come from src/engine/design/pmCandidates.js;
 *   the model can only demote a candidate by one tier when it departs from the null, never rescue a
 *   gate failure, and never order candidates by raw deltas. Candidates left in the top tier are
 *   reported as equally supported.
 *
 * Evidence here is model prediction. It does not predict cutting, HDR, protein function or clone fitness.
 */
import { alphaGenomeMapping, reviewRequestId } from "./alphaGenomeReview.js";
import { REGULATORY_CONTEXT_CATALOG } from "./regulatoryContexts.js";

export const CANDIDATE_RANKING_REQUEST_SCHEMA = "assured-alphagenome-candidates-request/1";
export const CANDIDATE_RANKING_REPORT_SCHEMA = "assured-alphagenome-ranking/1";
export const CANDIDATE_RANKING_SCHEMA = "assured-pm-candidate-ranking/1";
export const RANKING_METRICS_VERSION = 1;
export const RANKING_RULE = Object.freeze({
  version: 1,
  flagComposite: "composite p <= 0.05: largest deviation in null standard deviations, against the null of the same blocker count",
  flagP: 0.05,
  minReferenceSignal: 1.0, // mean plus-strand RNA-seq over the annotated exons below this: the context is reported as uninformative
  null: Object.freeze({ perK: 30, windowBp: 35, seed: 20261027 }),
  outputs: Object.freeze(["RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE"]),
});

const GRCH38_CHROMOSOMES = /^(?:[1-9]|1\d|2[0-2]|X|Y)$/;

/** Accept a catalog id ("glutamatergic-neuron") or an ontology identifier ("CL:0000679"). */
export function resolveContext(idOrOntology) {
  const hit = REGULATORY_CONTEXT_CATALOG.contexts.find((c) => c.id === idOrOntology || c.ontology === idOrOntology);
  if (hit) return { id: hit.id, ontology: hit.ontology, label: hit.label, match: hit.match };
  if (/^(?:UBERON|CL|EFO):\d+$/.test(String(idOrOntology))) return { id: idOrOntology, ontology: idOrOntology, label: idOrOntology, match: "custom" };
  throw new Error(`Unknown model context: ${idOrOntology}`);
}

/**
 * The request rank.py reads. Candidates that carry the same substitution set share one allele, so the model
 * is asked once per distinct allele. Returns { request, alleleOfCandidate }.
 */
export async function buildCandidateRankingRequest(project, candidateSet, {
  contexts, mapping = alphaGenomeMapping(project), mappingConfirmed = false, sequenceLength = 16384, nullSpec = {},
} = {}) {
  const gb = project?.designResult?.gb;
  if (!candidateSet || candidateSet.err || !candidateSet.candidates?.length) throw new Error("A candidate set with at least one candidate is required.");
  if (!gb?.genomicSequence) throw new Error("A design with an uploaded genomic reference is required.");
  if (!mappingConfirmed) throw new Error("Confirm the assembly and genomic mapping of the uploaded reference.");
  if (!mapping || mapping.assembly !== "GRCh38") throw new Error("This integration supports human GRCh38 only; no liftover or assembly inference.");
  const chrom = String(mapping.chromosome || "").replace(/^chr/i, "").toUpperCase();
  if (!GRCH38_CHROMOSOMES.test(chrom)) throw new Error("Choose a human chromosome 1-22, X or Y.");
  if (!Number.isSafeInteger(mapping.referenceStart) || mapping.referenceStart < 1) throw new Error("Provide the 1-based chromosome start of the uploaded reference.");
  if (mapping.orientation !== 1 || gb.strand !== 1) throw new Error("Candidate ranking currently supports plus-strand genes in a chromosome-forward reference only.");
  if (![16384, 131072].includes(sequenceLength)) throw new Error("Choose a 16,384 or 131,072 bp prediction context.");
  const resolved = (contexts?.length ? contexts : []).map(resolveContext);
  if (!resolved.length || resolved.length > 4 || new Set(resolved.map((c) => c.ontology)).size !== resolved.length) throw new Error("Choose one to four distinct cell contexts.");
  const genome = gb.genomicSequence.toUpperCase();
  if (genome.length > 1000000 || !/^[ACGTN]+$/.test(genome)) throw new Error("A valid uploaded genomic reference of at most 1 Mb is required.");
  const start = mapping.referenceStart;
  const chr = (index) => start + index; // 0-based index in the reference -> 1-based chromosome position
  const edit = candidateSet.edit;
  const intended = edit.positions.map((p, i) => ({ position: chr(p), ref: genome[p], alt: edit.bases[i] }));
  const editSet = new Set(edit.positions);
  const alleles = []; const alleleOfCandidate = {}; const bySignature = new Map();
  for (const c of candidateSet.candidates) {
    let id = bySignature.get(c.alleleSignature);
    if (!id) {
      id = `a${alleles.length + 1}`; bySignature.set(c.alleleSignature, id);
      alleles.push({ id, variants: c.substitutions.map((s) => ({ position: chr(s.index), ref: s.ref, alt: s.alt, role: editSet.has(s.index) ? "intended" : "blocking" })).sort((a, b) => a.position - b.position) });
    }
    alleleOfCandidate[c.id] = id;
  }
  const ks = [...new Set(candidateSet.candidates.map((c) => c.blockers.length))].filter((k) => k >= 1 && k <= 3).sort((a, b) => a - b);
  if (!ks.length) throw new Error("Candidates need one to three blocking changes to be compared with the null.");
  const exons = (gb.exons || []).map((e) => [chr(e.start), chr(e.end - 1)]);
  const cdsSegments = (gb.cdsSegments || []).map(([s, e]) => [chr(s), chr(e - 1)]);
  if (!exons.length || !cdsSegments.length) throw new Error("The reference needs annotated exons and a CDS.");
  const payload = {
    schema: CANDIDATE_RANKING_REQUEST_SCHEMA, gene: String(project.designResult.gene || project.gene || "Locus"),
    assembly: "GRCh38", chromosome: `chr${chrom}`,
    reference: { start, sequence: genome },
    annotation: { strand: "+", geneStart: chr(0), geneEnd: chr(genome.length - 1), exons, cdsSegments },
    contexts: resolved.map((c) => c.ontology), intended, alleles, sequenceLength,
    requestedOutputs: [...RANKING_RULE.outputs],
    null: { perK: nullSpec.perK ?? RANKING_RULE.null.perK, ks, windowBp: nullSpec.windowBp ?? RANKING_RULE.null.windowBp, seed: nullSpec.seed ?? RANKING_RULE.null.seed },
  };
  return { request: { ...payload, requestId: await reviewRequestId(payload) }, alleleOfCandidate, contexts: resolved };
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);

export function metricNames(ontology) {
  return [`M1_expr_log2|${ontology}`, `M2_local_rel|${ontology}`, `M5_usage_annot|${ontology}`, "M3_splice_annot_loss", "M4_new_site_gain"];
}

/** Throws unless the report belongs to this request and carries everything the rule needs. */
export function validateRankingReport(report, request) {
  const fail = (why) => { throw new Error(`This ranking report cannot be used: ${why}. Export and run a new request.`); };
  if (report?.schema !== CANDIDATE_RANKING_REPORT_SCHEMA || report.status !== "complete" || report.evidenceType !== "model-prediction") fail("it is incomplete or not a model-prediction ranking report");
  if (report.requestId !== request?.requestId) fail("it does not match the current candidates, mapping and contexts");
  if (report.metricsVersion !== RANKING_METRICS_VERSION) fail("it was made with a different metric definition");
  if (typeof report.modelVersion !== "string" || !report.modelVersion || typeof report.sdkVersion !== "string") fail("model or SDK version is missing");
  if (JSON.stringify(report.contexts) !== JSON.stringify(request.contexts)) fail("its contexts differ from the request");
  const wanted = request.alleles.map((a) => a.id);
  if (!Array.isArray(report.alleles) || JSON.stringify(report.alleles.map((a) => a.id)) !== JSON.stringify(wanted)) fail("its alleles differ from the request");
  const names = request.contexts.flatMap(metricNames);
  const metricsOk = (m) => m && names.every((n) => finite(m[n]));
  if (!report.alleles.every((a) => metricsOk(a.metrics))) fail("an allele is missing metrics");
  const n = report.null;
  if (!n || n.perK !== request.null.perK || JSON.stringify(n.ks) !== JSON.stringify(request.null.ks) || n.seed !== request.null.seed || n.windowBp !== request.null.windowBp) fail("the null does not match the requested specification");
  for (const k of request.null.ks) if ((n.alleles || []).filter((a) => a.k === k && metricsOk(a.metrics)).length !== request.null.perK) fail(`the null for ${k} blocking change${k === 1 ? "" : "s"} is incomplete`);
  if (!report.referenceSignal || !request.contexts.every((c) => finite(report.referenceSignal[c]?.exonMeanPlus))) fail("reference signal is missing");
  if (!finite(report.determinismMaxAbsDiff)) fail("the repeat-prediction check is missing");
  return report;
}

// ---- statistics ----------------------------------------------------------------------------------

// Output-resolution floors for the null's standard deviation, so that a one-step difference in a coarsely
// quantised metric cannot look extreme. 1/256 is the step of the probability outputs near 0.5-1.
const SCALE_FLOORS = Object.freeze({ M1_expr_log2: 0.002, M2_local_rel: 0.005, M3_splice_annot_loss: 1 / 256, M4_new_site_gain: 1 / 256, M5_usage_annot: 1 / 256 });
const floorOf = (metric) => SCALE_FLOORS[metric.split("|")[0]];

function zScores(metrics, pool, names) {
  const out = {};
  for (const m of names) {
    const x = pool.map((a) => a.metrics[m]);
    const mean = x.reduce((sum, v) => sum + v, 0) / x.length;
    const sd = Math.sqrt(x.reduce((sum, v) => sum + (v - mean) ** 2, 0) / x.length); // population sd, as numpy's default
    out[m] = (metrics[m] - mean) / Math.max(sd, floorOf(m));
  }
  return out;
}

/**
 * A donor's composite score is its largest upward deviation, in null standard deviations, across the five metrics,
 * measured against the null of the same blocker count. Its p value is the share of null alleles whose own composite
 * (measured against the rest of the null, leaving itself out) is at least as large, counting the donor itself. One p value across
 * five metrics keeps the false-flag rate near the stated level, where five separate 95th-percentile checks would flag about a
 * quarter of null-like alleles. Deviations keep their size: a rank-based composite saturates at 1.0 for any value above the null
 * maximum, so with five metrics and 30 null alleles it could never reach p <= 0.05.
 */
export function compositeScore(metrics, k, nullAlleles, ontology) {
  const names = metricNames(ontology);
  const pool = nullAlleles.filter((a) => a.k === k);
  if (!pool.length) throw new Error(`No null alleles for ${k} blocking change(s).`);
  const z = zScores(metrics, pool, names);
  const composite = Math.max(...Object.values(z));
  let atLeast = 0;
  pool.forEach((member, j) => {
    const own = Math.max(...Object.values(zScores(member.metrics, pool.filter((_, t) => t !== j), names)));
    if (own >= composite) atLeast += 1;
  });
  const p = (1 + atLeast) / (pool.length + 1);
  const aboveP95 = names.filter((m) => {
    const sorted = pool.map((a) => a.metrics[m]).sort((x, y) => x - y);
    const position = 0.95 * (sorted.length - 1); const lo = Math.floor(position); const hi = Math.ceil(position);
    return metrics[m] > sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo); // linear interpolation, as numpy.percentile
  });
  return { composite, p, z, aboveP95 };
}

// ---- decision rule -------------------------------------------------------------------------------

function whyLower(candidate, top, flaggedNames) {
  const reasons = [];
  const a = candidate.stage1; const best = Math.min(...top.map((t) => t.stage1.tier));
  if (a.tier > best) {
    const [win, robust, blockers] = a.key; const refKey = top[0].stage1.key;
    if (win > refKey[0]) reasons.push(`cut is more than ${candidate.rulePreferredWindow} bp from the edit`);
    if (robust > refKey[1]) reasons.push("protection rests on one spacer mismatch with the PAM intact");
    if (blockers > refKey[2]) reasons.push(`${blockers} blocking changes against ${refKey[2]}, a larger donor with more substitutions`);
  }
  if (flaggedNames.length) reasons.push(`AlphaGenome flagged it against the null (${flaggedNames.join(", ")})`);
  return reasons;
}

function tieBreak(candidates) {
  // A practical convention, not evidence: protection that does not depend on the blockers converting, then a closer cut, then GC nearer 50%.
  const key = (c) => [Number.isFinite(c.protection.editOnlyCfd) ? Math.round(c.protection.editOnlyCfd * 20) / 20 : 1, Math.abs(c.protection.cutToEditBp), Math.abs(c.guide.gc - 50)];
  const index = new Map(candidates.map((c, i) => [c.id, i]));
  return [...candidates].sort((x, y) => { const a = key(x); const b = key(y); for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return index.get(x.id) - index.get(y.id); }).map((c) => c.id);
}

/**
 * Apply the rule. `request` is the object from buildCandidateRankingRequest, `alleleOfCandidate` its map,
 * `report` the validated report. The first request context is the primary one.
 */
export function rankCandidates(candidateSet, { request, alleleOfCandidate, contexts, report }, options = {}) {
  validateRankingReport(report, request);
  const primary = request.contexts[0];
  const labelOf = (o) => contexts?.find((c) => c.ontology === o)?.label || o;
  const flagP = options.flagP ?? RANKING_RULE.flagP;
  const minSignal = options.minReferenceSignal ?? RANKING_RULE.minReferenceSignal;
  const informative = Object.fromEntries(request.contexts.map((c) => [c, report.referenceSignal[c].exonMeanPlus >= minSignal]));
  const alleleMetrics = Object.fromEntries(report.alleles.map((a) => [a.id, a.metrics]));
  const rows = candidateSet.candidates.map((c, order) => {
    const allele = alleleOfCandidate[c.id];
    const k = c.blockers.length;
    const perContext = Object.fromEntries(request.contexts.map((o) => {
      const s = compositeScore(alleleMetrics[allele], k, report.null.alleles, o);
      return [o, { p: s.p, composite: s.composite, flagged: informative[o] && s.p <= flagP, aboveP95: s.aboveP95, informative: informative[o], z: s.z }];
    }));
    const flagged = Boolean(perContext[primary].flagged);
    return { id: c.id, label: c.label, order, allele, stage1Tier: c.stage1.tier, flagged, finalTier: c.stage1.tier + (flagged ? 1 : 0), contexts: perContext, candidate: c };
  });
  const bestTier = Math.min(...rows.map((r) => r.finalTier));
  const top = rows.filter((r) => r.finalTier === bestTier);
  const topCandidates = top.map((r) => ({ ...r.candidate, rulePreferredWindow: candidateSet.rule.thresholds.preferredCutWindow }));
  const ranking = [...rows].sort((a, b) => a.finalTier - b.finalTier || a.stage1Tier - b.stage1Tier || a.order - b.order).map((r) => ({
    id: r.id, label: r.label, allele: r.allele, stage1Tier: r.stage1Tier, flagged: r.flagged, finalTier: r.finalTier, top: r.finalTier === bestTier,
    contexts: Object.fromEntries(Object.entries(r.contexts).map(([o, v]) => [o, { p: v.p, flagged: v.flagged, informative: v.informative }])),
    reasonsRankedLower: r.finalTier === bestTier ? [] : whyLower({ ...r.candidate, rulePreferredWindow: candidateSet.rule.thresholds.preferredCutWindow }, topCandidates, r.flagged ? r.contexts[primary].aboveP95 : []),
  }));
  const literalFlag = (r) => informative[primary] && r.contexts[primary].aboveP95.length > 0;
  const literalTiers = rows.map((r) => ({ id: r.id, finalTier: r.stage1Tier + (literalFlag(r) ? 1 : 0), flagged: literalFlag(r) }));
  const literalBest = Math.min(...literalTiers.map((r) => r.finalTier));
  const n = rows.length; const tie = top.length > 1;
  const contextLabel = labelOf(primary);
  const names = top.map((r) => r.id);
  const labels = top.map((r) => r.label);
  const wording = !informative[primary]
    ? `No regulatory ordering: ${contextLabel} carries too little predicted signal in this gene (reference exon RNA-seq ${report.referenceSignal[primary].exonMeanPlus.toFixed(2)}). Candidates stay in Stage-1 order.`
    : tie ? `Equally supported among ${n} candidates evaluated in ${contextLabel}: ${labels.join(" and ")}.`
      : `Best-supported among ${n} candidates evaluated in ${contextLabel}: ${labels[0]}.`;
  return {
    schema: CANDIDATE_RANKING_SCHEMA, rule: { ...RANKING_RULE, flagP, minReferenceSignal: minSignal },
    wording, nEvaluated: n, primaryContext: { ontology: primary, label: contextLabel, informative: informative[primary], referenceExonMeanPlus: report.referenceSignal[primary].exonMeanPlus },
    otherContexts: request.contexts.slice(1).map((o) => ({ ontology: o, label: labelOf(o), informative: informative[o], flagged: rows.filter((r) => r.contexts[o].flagged).map((r) => r.id) })),
    top: names, tie, tieBreak: tie ? { basis: "practical convention, not regulatory evidence: edit-only CFD (binned to 0.05), then cut distance, then GC distance from 50%", order: tieBreak(topCandidates) } : null,
    ranking,
    modelSeparatesCandidates: rows.some((r) => r.flagged),
    openRequirements: ["Genome-wide specificity has not been assessed for any candidate.", "AlphaGenome effect sizes are uncalibrated and the model does not predict cutting, HDR efficiency, clone fitness or protein function."],
    sensitivity: { literalAnyMetricAboveP95: { flagged: literalTiers.filter((r) => r.flagged).map((r) => r.id), top: literalTiers.filter((r) => r.finalTier === literalBest).map((r) => r.id) } },
    report: { modelVersion: report.modelVersion, sdkVersion: report.sdkVersion, requestId: report.requestId, determinismMaxAbsDiff: report.determinismMaxAbsDiff },
  };
}
