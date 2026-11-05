// From numbers to a decision. The lab does not want 38 percentages, it wants to know which clones to keep, which to hold and which to sequence again.
// Every decision carries its reasons, so that it can be checked against the traces; thresholds are options shown in the report.
//
//   accept         the genotype is what the experiment wanted and the result is reliable enough to act on
//   hold           a usable but not the wanted genotype (heterozygous, mixed, or an intended edit with a partial conversion): keep for a second round or decide by hand
//   reject         the clone does not carry the edit (wild type) or carries the wrong one
//   re-sequence    the data cannot decide (low confidence, an unusable read, reads that disagree, a window too short)

export const DECISION_DEFAULTS = { koMinEdited: 90, editMinIntendedLow: 85, wtMaxForKo: 10, goal: "homozygous" };

const koSize = (c) => c.size % 3 !== 0 || Math.abs(c.size) >= 21;

function decideCore(workflow, result, options = {}) {
  const opt = { ...DECISION_DEFAULTS, ...options }; const reasons = [];
  if (!result.ok) return { decision: "re-sequence", reasons: [result.error], next: "Check the file and the design, then repeat the sequencing or the analysis." };
  if (result.kind === "junction") {
    const status = result.verdict?.status;
    return status === "pass" ? { decision: "accept", reasons: [result.verdict.summary], next: "Confirm zygosity by out-out PCR." } : { decision: status === "fail" ? "reject" : "hold", reasons: [result.verdict?.summary || "see the report"], next: "Inspect the junction read." };
  }
  const confidence = result.confidence?.tier || "moderate";
  if (result.agreement && !result.agreement.agree) return { decision: "re-sequence", reasons: [`The reads disagree about the edited share (${result.reads.map((r) => `${r.name} ${r.editedPct}%`).join(", ")}).`], next: "Re-run the PCR and sequence both directions." };
  const s = result.summary; const g = result.genotype; const iv = result.intervals; const lowEdited = iv ? iv.editedPct[0] : s.editedPct; const highWt = iv ? iv.wtPct[1] : s.wtPct;
  const lowIntended = iv ? iv.intendedEditPct[0] : s.intendedEditPct;
  if (confidence === "low") reasons.push(`The result is not precise enough to decide (interval width ${result.confidence.width} points).`);
  if (result.warnings.some((w) => /readable bases lie downstream/.test(w))) reasons.push("Too little readable sequence after the cut.");
  if (reasons.length) return { decision: "re-sequence", reasons, next: "The fit could not settle this call. If the trace is poor, sequence again (shorter amplicon, or the other primer); if it is clean, look at the chromatogram: the signal may be a mixture of alleles." };
  const knock = workflow === "knockout" || workflow === "deletion";
  const category = g?.category || "";
  if (result.sampleType === "pool") return { decision: s.editedPct >= 20 ? "accept" : "hold", reasons: [`Pool: ${s.editedPct}% edited (interval ${iv ? `${iv.editedPct[0]}-${iv.editedPct[1]}` : "n/a"}).`], next: s.editedPct >= 20 ? "Proceed to single-cell cloning." : "Editing is low; consider re-transfection or enrichment." };
  if (g?.mixedClone) return { decision: "hold", reasons: [g.summary], next: "One allele is expected at this locus, so this clone is a mixture: re-single-cell it or choose another clone." };
  if (knock) {
    const alleles = g?.alleles || [];
    if (category === "homozygous_wt" || highWt >= 50) return { decision: "reject", reasons: ["No edit detected, or wild type is the major allele."], next: "Discard." };
    // With the gene record the call is the functional one (NMD, truncation, splice, in-frame), not the frame alone.
    const fn = result.functional;
    if (fn && lowEdited >= opt.koMinEdited && highWt <= opt.wtMaxForKo) {
      const status = fn.call.status;
      if (status === "predicted_knockout") return { decision: "accept", reasons: [g.summary, fn.call.text], next: "Confirm loss of protein by Western blot or mass spectrometry; Sanger cannot exclude a large deletion on the second allele." };
      if (status === "predicted_knockout_with_caveats") return { decision: "hold", reasons: [g.summary, fn.call.text, ...fn.caveats.slice(0, 2)], next: "Loss of function depends on a prediction that can fail (NMD escape, a truncated protein, reinitiation or an isoform): check the protein before using the clone." };
      return { decision: "hold", reasons: [g.summary, fn.call.text], next: "The protein may still be made: check it by Western blot, or choose another clone." };
    }
    // a deletion between the two cuts counts as a knockout only if it shifts the frame or removes at least 21 bases, like any other allele (found on held-out data: an in-frame 18-base deletion between the cuts was accepted)
    const allKo = alleles.length > 0 && alleles.every((a) => a.kind !== "wt" && koSize({ size: a.size }));
    if (lowEdited >= opt.koMinEdited && highWt <= opt.wtMaxForKo && allKo) return { decision: "accept", reasons: [g.summary, `Wild type at most ${highWt}%; every called allele shifts the frame or removes at least 21 bases.`], next: opt.goal === "homozygous" ? "Confirm loss of protein; Sanger cannot exclude a large deletion on the second allele." : "Confirm by protein." };
    if (!allKo && alleles.length) return { decision: "hold", reasons: [g.summary, "An allele is in frame and short (or unclear): the protein may be made."], next: "Check protein or choose another clone." };
    return { decision: "hold", reasons: [g?.summary || `Edited ${s.editedPct}% with wild type up to ${highWt}%.`], next: "Mixed or heterozygous: re-clone, or keep if a heterozygous knockout is acceptable." };
  }
  // SNP and tag knock-ins: the wanted genotype is the intended edit on both alleles
  if (category === "homozygous_wt" || (s.editedPct < 5 && lowIntended < 5)) return { decision: "reject", reasons: ["No edit detected."], next: "Discard." };
  if (category === "homozygous_edit" && lowIntended >= opt.editMinIntendedLow) return { decision: "accept", reasons: [g.summary, `Intended edit at least ${lowIntended}% (interval lower bound).`], next: "Confirm by out-out PCR and sequencing of the other primer; exclude off-target by WGS if required." };
  if (category === "homozygous_partial") return { decision: "reject", reasons: [g.summary, "Only the blocking changes were copied; the intended edit is absent."], next: "Discard (other tools would count this as HDR)." };
  if (category === "heterozygous_edit" || category === "edit_plus_indel" || category === "edit_plus_partial") return { decision: opt.goal === "homozygous" ? "hold" : "accept", reasons: [g.summary], next: opt.goal === "homozygous" ? "One allele is not corrected: second round of editing or choose another clone." : "Accepted as heterozygous." };
  if (category === "homozygous_edit_indel") return { decision: "hold", reasons: [g.summary], next: "The edit carries an indel near the cut: check the sequence by hand." };
  return { decision: "hold", reasons: [g?.summary || `Intended edit ${s.intendedEditPct}% (interval ${iv ? `${iv.intendedEditPct[0]}-${iv.intendedEditPct[1]}` : "n/a"}).`], next: "Mixed result: re-clone or check the traces." };
}

import { flagsFor } from "./unwanted.js";

// Workflows where the clone is meant to carry exactly the designed sequence: an unplanned protein-changing base is a reason to drop the clone there. In a knockout the
// protein is meant to be lost, and in base editing bystander edits are read from the editing-window table.
const EXACT_EDIT_WORKFLOWS = new Set(["snp", "tag_small"]);

/**
 * Add what the sequencing shows beyond the intended edit to the decision.
 *  - a protein-changing base the design did not plan, seen in two reads, in a workflow that wants the exact designed sequence: reject (`next` says why);
 *  - the same base seen in one read only (it would change the protein, but a read artefact is possible): sequence again before the clone is used;
 *  - any other unplanned base, or a read that differs from the control at many positions: an accepted clone is held, an undecided one keeps its decision with the reason added.
 * A rejected clone stays rejected. Pass options.holdOnUnplanned = false to switch all of this off.
 */
export function decide(workflow, result, options = {}) {
  const d = decideCore(workflow, result, options);
  if (!result.ok || result.kind === "junction" || options.holdOnUnplanned === false || d.decision === "reject" && !result.unwanted) return annotate(d, result);
  const unwanted = result.unwanted || null;
  const hits = result.unplanned || [];
  if (!unwanted) { // results without the unwanted-change report (saved by an earlier version): the original rule
    if (d.decision === "reject" || !hits.length) return d;
    const where = hits.map((h) => `${h.relative >= 0 ? "+" : ""}${h.relative} ${h.change} (${Math.round(h.fraction * 100)}%)`).join(", ");
    const reasons = [...d.reasons, `Unplanned base change near the cut: ${where}.`];
    if (d.decision !== "accept") return { ...d, reasons };
    return { decision: "hold", reasons, next: "Look at the trace at that position and sequence the other direction before using this clone; it may carry a second edit or a variant." };
  }
  const flags = flagsFor({ unwanted }, workflow).filter((f) => f.severity !== "info");
  if (!flags.length) return annotate(d, result, null);
  const texts = flags.map((f) => f.text);
  const exact = EXACT_EDIT_WORKFLOWS.has(workflow) && result.sampleType !== "pool"; // a pool is a mixture of edits: a base in it is not a reason to drop it
  const confirmedDamage = unwanted.changes?.some((c) => c.severity === "block");
  const singleDamage = unwanted.changes?.some((c) => c.consequence?.proteinChanging && !c.confirmed);
  const messy = flags.some((f) => f.code === "many-differences");
  const keep = (x) => annotate(x, result, "review");
  if (exact && confirmedDamage) {
    return annotate({ decision: "reject", reasons: [...texts, ...(d.decision === "reject" ? d.reasons : [])], next: "Do not carry this clone forward: it carries a base change that alters the protein and was not part of the design. Choose another clone." }, result, "block");
  }
  if (d.decision === "reject") return { ...d, reasons: [...d.reasons, ...texts] };
  if (exact && singleDamage && d.decision !== "re-sequence") {
    return annotate({ decision: "re-sequence", reasons: [...texts, ...(d.decision === "accept" ? [] : d.reasons)], next: "Sequence the clone from the other direction: a protein-changing base seen in one read has to be confirmed before the clone is used or dropped." }, result, "review");
  }
  if (messy && d.decision === "accept") return keep({ decision: "re-sequence", reasons: [...texts, ...d.reasons], next: "Look at the trace: many positions differ from the control, which a clean clone does not show. Sequence again (shorter amplicon, or the other primer) if the trace is poor." });
  if (d.decision !== "accept") return keep({ ...d, reasons: [...d.reasons, ...texts] });
  return keep({ decision: "hold", reasons: [...texts, ...d.reasons], next: "Look at the trace at that position and sequence the other direction before using this clone; it may carry a second edit or a variant." });
}

// The unwanted-change level is recorded with the decision so that a table can show why a clone was held or dropped.
function annotate(d, result, level) {
  const worst = level === undefined ? result.unwanted?.worst || null : level;
  return worst && worst !== "info" ? { ...d, unwanted: worst } : d;
}

export const DECISION_ORDER = ["accept", "hold", "re-sequence", "reject"];
export function tally(decisions) { const out = {}; DECISION_ORDER.forEach((d) => { out[d] = 0; }); decisions.forEach((d) => { out[d.decision] += 1; }); return out; }

/** Well coordinates from a file or sample name: "..._A01_...", "A1", "H12". */
export function wellOf(name) {
  const m = String(name).replace(/^.*[\\/]/, "").match(/(?:^|[^A-Za-z0-9])([A-Ha-h])[-_]?(0?[1-9]|1[0-2])(?![A-Za-z0-9])/); if (!m) return null;
  return `${m[1].toUpperCase()}${Number(m[2])}`;
}
