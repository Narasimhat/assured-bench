// The flags of a clone as the clone table shows them: what the traces show beyond the intended edit (engine/qc/unwanted.js) and what the splice and expression
// predictors say about it when they were run (cloneReview.js). Pure functions; the components only draw what these return.
import { flagsFor } from "../engine/qc/unwanted.js";

export const SEVERITY_RANK = Object.freeze({ block: 2, review: 1, info: 0 });
const VERDICT_TEXT = { pass: "supports the clone", review: "asks for review", fail: "advises against the clone" };

/**
 * @param {object} result one QC result (with workflow, decision, unwanted)
 * @param {{ splice?: { clones: object, tool: string, version: string }, alphagenome?: { clones: object } }|null} review summaries of the imported predictor results (fresh ones only)
 * @returns {Array<{ source: "trace"|"SpliceAI"|"AlphaGenome", code: string, severity: "block"|"review"|"info", text: string }>}
 */
export function cloneFlags(result, review = null) {
  if (!result || !result.ok) return [];
  const flags = flagsFor(result).map((f) => ({ source: "trace", code: f.code, severity: f.severity, text: f.text }));
  const splice = review?.splice?.clones?.[result.name];
  if (splice && splice.verdict !== "pass") {
    flags.push({ source: "SpliceAI", code: "splice-" + splice.verdict, severity: splice.verdict === "fail" ? "block" : "review",
      text: `${review.splice.tool} predicts a splice change of ${splice.effect.toFixed(3)} (${splice.basis}; allele ${splice.label}) and ${VERDICT_TEXT[splice.verdict]} at the design review's thresholds. A model prediction, not a measurement: confirm by RT-PCR if the clone is used.` });
  }
  const ag = review?.alphagenome?.clones?.[result.name];
  if (ag && ag.unwanted) {
    flags.push({ source: "AlphaGenome", code: "alphagenome-delta", severity: "info",
      text: `AlphaGenome: the largest predicted change in splice-site signal against the ${ag.comparison === "intended_to_allele" ? "intended allele" : "reference"} is ${ag.spliceScore.toPrecision(3)} (raw track units, no calibrated threshold; a ranking, not a verdict).` });
  }
  return flags.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** Flags that call for action (not notes). */
export const actionableFlags = (result, review = null) => cloneFlags(result, review).filter((f) => f.severity !== "info");
export const worstSeverity = (flags) => (flags.length ? flags.reduce((w, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[w] ? f.severity : w), "info") : null);

/** The clones with an actionable flag, worst first. */
export function flaggedClones(results, review = null) {
  return (results || []).map((r) => ({ result: r, flags: actionableFlags(r, review) })).filter((x) => x.flags.length)
    .sort((a, b) => SEVERITY_RANK[worstSeverity(b.flags)] - SEVERITY_RANK[worstSeverity(a.flags)]);
}

/** Short label for a chip. */
export function chipLabel(flag) {
  const labels = { "unplanned-base": "Unplanned base", "many-differences": "Many differences", "misaligned-stretch": "Misaligned stretch", "blocking-only": "Incomplete conversion", "indel-at-cut": "Indel allele",
    "reads-disagree": "Reads disagree", "low-fit": "Poor fit", "splice-review": "Splice: review", "splice-fail": "Splice: against", "alphagenome-delta": "AlphaGenome" };
  return labels[flag.code] || flag.code;
}
