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
  if (reasons.length) return { decision: "re-sequence", reasons, next: "Sequence again (shorter amplicon, or the other primer); the current trace cannot settle it." };
  const knock = workflow === "knockout" || workflow === "deletion";
  const category = g?.category || "";
  if (result.sampleType === "pool") return { decision: s.editedPct >= 20 ? "accept" : "hold", reasons: [`Pool: ${s.editedPct}% edited (interval ${iv ? `${iv.editedPct[0]}-${iv.editedPct[1]}` : "n/a"}).`], next: s.editedPct >= 20 ? "Proceed to single-cell cloning." : "Editing is low; consider re-transfection or enrichment." };
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

/** A clone that would be accepted but carries a base change the design did not ask for is held: it needs a look at the trace. */
export function decide(workflow, result, options = {}) {
  const d = decideCore(workflow, result, options);
  const hits = result.ok && result.kind !== "junction" ? result.unplanned || [] : [];
  if (d.decision === "reject" || !hits.length || options.holdOnUnplanned === false) return d;
  const where = hits.map((h) => `${h.relative >= 0 ? "+" : ""}${h.relative} ${h.change} (${Math.round(h.fraction * 100)}%)`).join(", ");
  const reasons = [...d.reasons, `Unplanned base change near the cut: ${where}.`];
  if (d.decision !== "accept") return { ...d, reasons };
  return { decision: "hold", reasons, next: "Look at the trace at that position and sequence the other direction before using this clone; it may carry a second edit or a variant." };
}

export const DECISION_ORDER = ["accept", "hold", "re-sequence", "reject"];
export function tally(decisions) { const out = {}; DECISION_ORDER.forEach((d) => { out[d] = 0; }); decisions.forEach((d) => { out[d.decision] += 1; }); return out; }

/** Well coordinates from a file or sample name: "..._A01_...", "A1", "H12". */
export function wellOf(name) {
  const m = String(name).replace(/^.*[\\/]/, "").match(/(?:^|[^A-Za-z0-9])([A-Ha-h])[-_]?(0?[1-9]|1[0-2])(?![A-Za-z0-9])/); if (!m) return null;
  return `${m[1].toUpperCase()}${Number(m[2])}`;
}
