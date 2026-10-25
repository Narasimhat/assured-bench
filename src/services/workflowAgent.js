import { ENZYMES, ENZYME_CONFIG_VERSION, getEnzyme } from "../engine/design/enzymeConfig.js";
import { runDesign, summarizeProcurementReadiness, summarizePrimerReadiness } from "../engine/design/designEngine.js";
import { getReleaseVerdict } from "../engine/design/releaseVerdict.js";

export const WORKFLOW_AGENT_VERSION = "1.0.0";
export const AGENT_PRIORITIES = {
  balanced: "Protection, then cut proximity",
  closest: "Closest cut, then protection",
  minimalChanges: "Fewest blocking changes, then proximity",
};

export function agentRequest(project, enzymes, priority = "balanced") {
  if (!Object.hasOwn(AGENT_PRIORITIES, priority)) throw Error("Choose a supported recommendation priority.");
  const selected = [...new Set(enzymes)];
  if (!selected.length) throw Error("Select at least one available enzyme.");
  selected.forEach(getEnzyme);
  if (!["ko", "pm", "it", "nt", "ct"].includes(project.editType)) throw Error("Use a coding modification for enzyme comparison. Genomic SNP comparison is not available in this version.");
  if (!project.genbankRaw?.trim()) throw Error("Fetch a gene or upload an annotated GenBank reference first.");
  if (["pm", "it"].includes(project.editType) && !project.mutation?.trim()) throw Error("Enter the requested protein change or insertion site first.");
  // Reuse design rules, but never transfer guide sequences, repeat verification or
  // previous risk acknowledgements from one enzyme to another.
  const options = { ...project.options };
  for (const key of ["customGuides", "directRepeat", "repeatSource", "repeatVerified", "spacerLength", "enzyme", "weakProtectionAcceptance", "acceptWeakProtection", "weakProtectionReason", "acknowledgeWeakProtection", "weakProtectionAcceptedBy", "acceptedBy"]) delete options[key];
  return { projectId: project.id, gene: project.geneMeta?.geneSymbol || project.gene?.trim() || "",
    editType: project.editType, mutation: project.mutation || "", tag: project.tag || "",
    homologyArmLength: project.homologyArmLength, genbankRaw: project.genbankRaw,
    options, enzymes: selected, priority };
}

export function summarizeAgentCandidate(enzyme, result, type) {
  const config = getEnzyme(enzyme);
  if (!result || result.err) return { enzyme, name: config.name, pam: config.pam_pattern, eligible: false,
    status: "unavailable", reasons: [result?.err || "No design returned."], metrics: null, result: null };
  const verdict = getReleaseVerdict(result);
  const guides = result.gs || [], donors = result.os || [];
  const problems = [];
  if (type === "ko" && guides.length !== 2) problems.push("A knockout requires two guides.");
  if (type === "pm" && (!donors.length || donors.some(d => d.od?.length !== 127 || !d.proteinValidation?.valid))) problems.push("A valid 127 nt protein-checked SNP donor is required.");
  if (["it", "nt", "ct"].includes(type) && !result.insertValidation?.framePreserved) problems.push("The insert must preserve the intended coding frame.");
  const pairs = verdict.guidePairs || [];
  const strong = pairs.filter(p => p.tier === "strong").length;
  const distances = guides.map(g => Math.abs(g.d)).filter(Number.isFinite);
  const changes = new Set((result.ss || []).map(s => JSON.stringify([s.gp ?? s.p, s.nc ?? s.sequence]))).size;
  const metrics = { guideCount: guides.length, donorCount: donors.length,
    distance: type === "ko" ? null : distances.length ? Math.min(...distances) : null,
    strongPairs: strong, totalPairs: pairs.length,
    protectionPenalty: type === "ko" ? 0 : pairs.length ? 1 - strong / pairs.length : 1,
    knockoutPenalty: type === "ko" ? result.deletionOutcome?.frameshiftPredicted ? 0
      : result.deletionOutcome?.spliceDonorRemoved && result.deletionOutcome?.exonSkippingFrameshiftPredicted ? 1 : 2 : null,
    spacerLength: guides[0]?.sp?.length || config.spacer_len.default,
    extraChanges: changes, primersReady: summarizePrimerReadiness(result).ready };
  const eligible = verdict.status !== "blocked" && guides.length > 0 && problems.length === 0;
  const reasons = [
    type === "ko" ? `Two-guide knockout; predicted deletion ${result.deletionOutcome?.deletionSize ?? "not recorded"} bp; nominal junction ${result.deletionOutcome?.frameshiftPredicted ? "shifts the reading frame" : "does not predict a frameshift"}. Staggered cuts and repair can change the junction.`
      : `Nearest selected cut: ${metrics.distance ?? "unknown"} bp from the edit; ${strong}/${pairs.length} guide–donor pairs have strong computed protection.`,
    `${changes} distinct documented blocking change(s); screening primers ${metrics.primersReady ? "pass the configured checks" : "need review"}.`,
    ...problems, ...verdict.blockers,
  ];
  return { enzyme, name: config.name, pam: config.pam_pattern, eligible, status: verdict.status,
    reasons, warnings: verdict.warnings, standingRequirements: verdict.standingRequirements, metrics, result };
}

function rankKey(candidate, priority) {
  const m = candidate.metrics;
  if (!m) return [2];
  const readiness = candidate.status === "ready" ? 0 : candidate.status === "review" ? 1 : 2;
  if (candidate.result?.type === "ko") return [candidate.eligible ? 0 : 1, readiness, m.knockoutPenalty ?? 2, m.primersReady ? 0 : 1];
  const distance = m.distance ?? (candidate.result?.type === "ko" ? 0 : Infinity);
  const order = priority === "closest" ? [distance, m.protectionPenalty, m.extraChanges]
    : priority === "minimalChanges" ? [m.extraChanges, distance, m.protectionPenalty]
    : [m.protectionPenalty, distance, m.extraChanges];
  return [candidate.eligible ? 0 : 1, readiness, ...order, m.primersReady ? 0 : 1];
}
function compareKeys(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? Infinity) !== (b[i] ?? Infinity)) return (a[i] ?? Infinity) < (b[i] ?? Infinity) ? -1 : 1;
  }
  return 0;
}

export function rankAgentCandidates(candidates, priority = "balanced") {
  if (!Object.hasOwn(AGENT_PRIORITIES, priority)) throw Error("Unknown recommendation priority.");
  const ranked = [...candidates].sort((a, b) => compareKeys(rankKey(a, priority), rankKey(b, priority)) || a.name.localeCompare(b.name));
  let rank = 0, previous;
  return ranked.map((candidate, index) => {
    const key = rankKey(candidate, priority);
    if (!previous || compareKeys(previous, key)) rank = index + 1;
    previous = key;
    return { ...candidate, rank, recommended: candidate.eligible && rank === 1 };
  });
}

export async function runWorkflowAgent(request, { onProgress = () => {}, runner = runDesign } = {}) {
  const results = [];
  for (let index = 0; index < request.enzymes.length; index++) {
    const enzyme = request.enzymes[index], config = getEnzyme(enzyme);
    onProgress({ completed: index, total: request.enzymes.length, enzyme: config.name });
    const options = { ...request.options, enzyme, spacerLength: config.spacer_len.default,
      directRepeat: config.direct_repeat || "", repeatVerified: false, repeatSource: "",
      expectedGene: request.gene, ensureGuidePair: true, allowNonCodingBlockers: true };
    let result;
    try {
      result = runner(request.editType, request.genbankRaw, request.mutation, request.tag,
        ["ct", "nt"].includes(request.editType) ? Number(request.homologyArmLength) : "", options);
      if (!result.err) result.procurement = summarizeProcurementReadiness(result);
    } catch (error) { result = { err: error.message || String(error) }; }
    results.push(summarizeAgentCandidate(enzyme, result, request.editType));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { schema: "assured-workflow-agent/1", agentVersion: WORKFLOW_AGENT_VERSION,
    configVersion: ENZYME_CONFIG_VERSION, createdAt: new Date().toISOString(),
    inputs: { gene: request.gene, editType: request.editType, mutation: request.mutation, tag: request.tag,
      homologyArmLength: request.homologyArmLength, options: request.options },
    knockoutRanking: "Within release gates: nominal frameshift, then splice-donor removal with frame-disrupting exon skipping, then other two-guide plans; then primer checks. This is mechanistic evidence, not a knockout probability.",
    rankingRule: "Eligible designs and configured release gates first; then selected priority; then primer readiness. Exact ties are retained.",
    priority: request.priority, enzymesCompared: request.enzymes,
    excludedEnzymes: Object.keys(ENZYMES).filter(id => !request.enzymes.includes(id)),
    candidates: rankAgentCandidates(results, request.priority),
    limitations: [
      "Ranking compares computed design constraints, not measured editing efficiency. No cross-enzyme activity or genome-wide specificity comparison has been performed.",
      "Base editing, prime editing and genomic SNP comparison are outside this version. This agent compares the supported nuclease/HDR workflows.",
      "Missing activity scores remain unknown. Strong protection describes the configured sequence check; it is not proof that re-cutting cannot occur.",
      "Guide-specific inputs and previous repeat verification are not transferred between enzymes. Confirm reagent compatibility and all release requirements before ordering.",
    ] };
}

export function agentAudit(report, selectedEnzyme) {
  return { ...report, selectedEnzyme, candidates: report.candidates.map(({ result, ...candidate }) => candidate) };
}

export function workflowNextSteps(result) {
  if (!result) return ["Fetch a reference and describe the modification, then compare the enzymes available in your lab."];
  const verdict = getReleaseVerdict(result);
  return [
    verdict.status === "blocked" ? "Resolve the design blockers and regenerate; do not order this design."
      : "Review the selected guide(s), matched donor(s), protein checks and screening primers in the full report.",
    "Complete genome-wide specificity and reagent/scaffold checks; review every release requirement before ordering.",
    result.type === "ko" ? "Use the selected two-guide deletion plan and its screening primers."
      : result.type === "pm" ? "Use the matched 127 nt donor and its documented blocking changes; do not mix alternative guide–donor pairs unless co-delivery passed."
      : "Confirm the insert, reading frame, donor format and both junction-screening assays.",
    "Send this exact design to QC, upload the parental control and edited traces, and review the existing clone decisions and ranking. Confirm final clones independently.",
  ];
}

export function isAgentAudit(value) {
  return value?.schema === "assured-workflow-agent/1" && Array.isArray(value.candidates)
    && value.candidates.every(c => c && Object.hasOwn(ENZYMES, c.enzyme)
      && typeof c.name === "string" && typeof c.status === "string"
      && Array.isArray(c.reasons) && c.reasons.every(t => typeof t === "string")
      && (!c.warnings || Array.isArray(c.warnings) && c.warnings.every(t => typeof t === "string")))
    && Array.isArray(value.limitations) && value.limitations.every(t => typeof t === "string");
}

export function qcNextAction(results = []) {
  if (!results.length) return "QC has not run yet. Upload parental-control and edited traces with the selected design.";
  const accepted = results.filter(r => r.ok && (r.decision?.decision || r.decision?.verdict) === "accept");
  const ranked = accepted.filter(r => Number.isFinite(r.recommendation?.rank ?? r.rank) && (r.recommendation?.rank ?? r.rank) > 0)
    .sort((a, b) => (a.recommendation?.rank ?? a.rank) - (b.recommendation?.rank ?? b.rank));
  if (ranked.length) {
    const best = ranked[0].recommendation?.rank ?? ranked[0].rank;
    const names = ranked.filter(r => (r.recommendation?.rank ?? r.rank) === best).map(r => r.name || r.sample || "unnamed sample");
    return "Existing QC ranks these accepted samples first: " + names.join(", ") + ". Review their trace evidence and confirm final clones independently.";
  }
  return accepted.length ? accepted.length + " sample(s) accepted by QC; no ranked winner is recorded. Review the individual evidence."
    : "No sample is accepted by QC. Follow the recorded hold, re-sequence or reject reasons before choosing a clone.";
}
