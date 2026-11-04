// Unwanted changes in a clone: what the sequencing shows that the design did not ask for, what each change does to the protein, and whether it
// should stop the clone from being used.
//
// Three kinds of finding are reported for every sample:
//  - base changes the design did not plan (the scan in unplanned.js, every read, forward-strand coordinates), each with the codon it falls in;
//  - structural signals that are not part of the intended edit (an indel allele next to an HDR allele, blocking-only conversion, a many-base misfit);
//  - signals that the data cannot be relied on (reads that disagree, a poor fit).
// Each flag has a severity: "block" (do not carry the clone forward), "review" (hold: look at the trace or sequence again) or "info".
// These are calls from Sanger traces, not measurements of the genome: a base seen in one read only may be a read artefact, and a heterozygous
// base cannot be placed on one allele. Predicted protein effects follow the reading frame the design gives (or the gene record when one is loaded).

import { codonPositions, aaOf } from "./protein.js";
import { assessAllele, diffWindow } from "./coding.js";

const COMP = { A: "T", C: "G", G: "C", T: "A", N: "N" };
const DAMAGING = new Set(["nonsense", "start-loss", "stop-loss", "splice-site"]);
export const UNWANTED_MODEL = "unwanted-changes/1";
const T0 = { runFrom: 30, runTo: 150 };
export const UNWANTED_THRESHOLDS = Object.freeze({ blockingOnlyPct: 10, indelAlleleFraction: 0.1, lowFitR2: 0.8, wildTypeResidualPct: 20 });

/** Map an engine allele class (coding.js) to the protein effect words used here. */
function classFromAssessment(a) {
  switch (a.class) {
    case "no_coding_effect": return "noncoding";
    case "synonymous": return "synonymous";
    case "inframe": case "inframe_region_hit": return "missense";
    case "lof_truncation": case "lof_nmd": case "truncation_uncertain": case "truncation_reinit_uncertain": case "frameshift_no_stop": return "nonsense";
    case "lof_start_loss": case "start_loss_uncertain": return "start-loss";
    case "stop_loss": return "stop-loss";
    case "lof_splice": case "splice_uncertain": return "splice-site";
    default: return "unknown";
  }
}

/**
 * The protein effect of one substitution on the forward strand of the design reference.
 * @param spec the design (annotated with spec.protein when the design names its codons)
 * @param coding a coding context (gene record) or null
 * @param {{ position: number, ref: string, alt: string }} change position = index in spec.reference.sequence
 * @returns {{ class: string, damaging: boolean, proteinChanging: boolean, label: string, codonFrom?: string, codonTo?: string, residue?: number, nearSplice?: boolean, basis: string, summary: string }}
 */
export function consequenceOf(spec, coding, change) {
  const reference = String(spec?.reference?.sequence || "").toUpperCase();
  const { position, ref, alt } = change;
  const out = { class: "unknown", damaging: false, proteinChanging: false, label: "", basis: "none", summary: "No reading frame is known for this design, so the protein effect of this change was not assessed." };
  if (!reference || reference[position] !== ref) return { ...out, summary: "The changed base does not match the design reference, so its protein effect was not assessed." };
  const p = spec.protein;
  if (p) {
    const cp = codonPositions(reference.length, position, p.strand, p.frame);
    const beyond = cp && p.cdsEnd !== null && p.cdsEnd !== undefined && cp.c > p.cdsEnd;
    if (!cp) Object.assign(out, { class: "unknown", summary: "The changed base lies at the edge of the reference, outside a complete codon." });
    else if (beyond) Object.assign(out, { class: "noncoding", basis: "design codon frame", summary: "The base lies after the stop codon in the design's reading frame." });
    else {
      const base = (q, sub) => { const b = q === position ? sub : reference[q]; return p.strand === "+" ? b : COMP[b] || "N"; };
      const codonFrom = cp.cols.map((q) => base(q, ref)).join(""); const codonTo = cp.cols.map((q) => base(q, alt)).join("");
      const from = aaOf(codonFrom); const to = aaOf(codonTo); const residue = cp.c + p.offset;
      const cls = from === to ? "synonymous" : to === "*" ? "nonsense" : from === "*" ? "stop-loss" : residue === 1 && from === "M" ? "start-loss" : "missense";
      Object.assign(out, { class: cls, label: `${from}${residue}${to}`, codonFrom, codonTo, residue, basis: "design codon frame",
        summary: cls === "synonymous" ? `Silent: ${codonFrom} > ${codonTo} keeps ${from}${residue}.` : cls === "nonsense" ? `Creates a stop codon at residue ${residue} (${from}${residue}*, ${codonFrom} > ${codonTo}).` : cls === "stop-loss" ? `Removes the stop codon (*${residue}${to}).` : cls === "start-loss" ? "Changes the start codon." : `Changes ${from}${residue} to ${to} (${codonFrom} > ${codonTo}).` });
    }
  }
  if (coding) {
    try {
      const a = assessAllele(coding, reference.slice(0, position) + alt + reference.slice(position + 1));
      const cls = classFromAssessment(a);
      if (cls !== "unknown" || out.class === "unknown") {
        const keepCodon = p && out.codonFrom && cls === out.class;
        Object.assign(out, { class: cls, basis: "gene record", nearSplice: Boolean(a.details?.nearSplice), summary: keepCodon ? `${out.summary} ${a.summary || ""}`.trim() : (a.summary || out.summary) });
        if (!keepCodon) { delete out.codonFrom; delete out.codonTo; delete out.residue; out.label = out.label && cls === "noncoding" ? "" : out.label; }
      }
    } catch { /* keep the codon-frame result */ }
  }
  out.damaging = DAMAGING.has(out.class);
  out.proteinChanging = out.damaging || out.class === "missense";
  return out;
}

/** Workflows in which the clone is meant to carry the designed edit (the flags that only make sense there are marked knockInOnly). */
export const KNOCK_IN_WORKFLOWS = new Set(["snp", "tag_small", "reporter"]);
/** The flags that apply to a result under the workflow it was run with (a knockout is not a knock-in: an indel there is the wanted outcome). */
export const flagsFor = (result, workflow = result?.workflow) => ((result && result.unwanted && result.unwanted.flags) || []).filter((f) => !f.knockInOnly || KNOCK_IN_WORKFLOWS.has(workflow));
const pctText = (fraction) => `${Math.round(fraction * 100)}%`;
const where = (c) => `${c.relative >= 0 ? "+" : ""}${c.relative} from the first cut`;

/** Severity and wording of one unplanned base change. */
function judge(c) {
  const effect = c.consequence;
  const evidence = c.confirmed ? `seen in ${c.readsSeen} reads` : c.discordant ? `seen in one read; ${c.readsCovering - c.readsSeen} other read${c.readsCovering - c.readsSeen > 1 ? "s" : ""} covering the base show the reference` : "seen in one read only";
  const protein = effect.label ? ` (${effect.label}, ${effect.class})` : effect.class !== "unknown" ? ` (${effect.class})` : "";
  let severity;
  if (effect.proteinChanging) severity = c.confirmed ? "block" : "review";
  else severity = "review";
  const action = severity === "block" ? "The clone carries a protein-changing base the design did not ask for: do not carry it forward."
    : effect.proteinChanging ? "It would change the protein; confirm it by sequencing the other direction before using the clone."
      : "Look at the trace before using the clone.";
  return { severity, text: `${c.ref}>${c.alt} at ${where(c)}${protein}, ${pctText(c.fraction)} of the signal, ${evidence}${c.lowFit ? " (poor overall fit, so treated with less confidence)" : ""}. ${action}`, evidence };
}

/**
 * The unwanted-change report of one analysed sample.
 * @param {{ spec: object, coding?: object|null, result: object }} input result = the engine's analysis (unplanned, unplannedOverflow, summary, decomposition, genotype, agreement, quality)
 * @returns {{ changes: Array<object>, flags: Array<{ code: string, severity: "block"|"review"|"info", text: string }>, worst: "block"|"review"|"info"|null, proteinChanging: boolean, confirmedProteinChange: boolean }}
 */
export function buildUnwanted({ spec, coding = null, result }) {
  const flags = []; const changes = [];
  for (const raw of result.unplanned || []) {
    const consequence = consequenceOf(spec, coding, raw);
    const change = { ...raw, consequence };
    const judged = judge(change);
    changes.push({ ...change, severity: judged.severity });
    flags.push({ code: "unplanned-base", severity: judged.severity, text: judged.text, position: raw.position });
  }
  for (const o of result.unplannedOverflow || []) {
    flags.push({ code: "many-differences", severity: "review", text: `${o.name}: ${o.count} positions differ from the control in the unedited stretch. That pattern means a rearranged or mixed read, a contaminated template or a poor trace, not single base changes: sequence the clone again.` });
  }
  for (const run of result.unplannedRuns || []) {
    const near = run.relativeTo >= -T0.runFrom && run.relativeFrom <= T0.runTo; // inside the stretch the fit reads (25 bases before the cut to 150 after)
    flags.push({ code: "misaligned-stretch", severity: near ? "review" : "info", text: `${run.name}: ${run.count} neighbouring positions between ${run.relativeFrom >= 0 ? "+" : ""}${run.relativeFrom} and ${run.relativeTo >= 0 ? "+" : ""}${run.relativeTo} differ from the control. The two reads are out of register there (a base call missed or added) or the stretch is poor, so these were not read as base changes${near ? "; the fit uses this stretch, so check the trace" : ""}.` });
  }
  const s = result.summary || {};
  const T = UNWANTED_THRESHOLDS;
  if (Number.isFinite(s.partialConversionPct) && s.partialConversionPct >= T.blockingOnlyPct) {
    flags.push({ code: "blocking-only", severity: "review", knockInOnly: true, text: `${s.partialConversionPct}% of the alleles carry only part of the planned changes (the silent blocking changes without the intended edit, or the edit without its blockers): the conversion is incomplete and the clone is not a clean knock-in.` });
  }
  if ((result.decomposition?.contributions || []).some((c) => (c.kind === "indel" || c.kind === "edit_indel") && c.fraction >= T.indelAlleleFraction)) {
    const alleles = result.decomposition.contributions.filter((c) => (c.kind === "indel" || c.kind === "edit_indel") && c.fraction >= T.indelAlleleFraction);
    flags.push({ code: "indel-at-cut", severity: "review", knockInOnly: true, text: `An indel allele sits next to the intended edit (${alleles.map((c) => `${c.label} ${pctText(c.fraction)}`).join(", ")}): the clone is not a clean knock-in. An indel allele is a second, unplanned change at the cut; whether it matters depends on the gene (dosage, X-linkage).` });
  }
  if (result.agreement && result.agreement.agree === false) {
    flags.push({ code: "reads-disagree", severity: "review", text: `The reads disagree about the edited share (spread ${Math.round(result.agreement.spread)} points). A PCR or sequencing artefact or a mixed template is more likely than biology: sequence again from both ends.` });
  }
  const r2 = result.decomposition?.r2;
  if (r2 !== null && r2 !== undefined && r2 < T.lowFitR2) {
    flags.push({ code: "low-fit", severity: "info", text: `The allele library explains only ${Math.round(r2 * 100)}% of the difference from wild type: the sample may carry a change the design does not predict.` });
  }
  const order = { block: 2, review: 1, info: 0 };
  const worst = flags.length ? flags.reduce((w, f) => (order[f.severity] > order[w] ? f.severity : w), "info") : null;
  return {
    model: UNWANTED_MODEL, changes, flags, worst,
    proteinChanging: changes.some((c) => c.consequence.proteinChanging),
    confirmedProteinChange: changes.some((c) => c.consequence.proteinChanging && c.confirmed),
  };
}

const rc = (s) => [...String(s)].reverse().map((b) => COMP[b] || "N").join("");
/** The changes of an allele sequence against the reference, as edits [start, end) -> inserted. Same length: one edit per changed base. Otherwise: one replacement. null when it is too scattered to be one allele. */
function editsBetween(reference, allele) {
  if (reference.length === allele.length) {
    const out = [];
    for (let i = 0; i < reference.length; i += 1) if (reference[i] !== allele[i]) out.push({ start: i, end: i + 1, ref: reference[i], inserted: allele[i] });
    return out.length > 12 ? null : out;
  }
  const d = diffWindow(reference, allele);
  return d ? [{ start: d.s, end: d.e, ref: reference.slice(d.s, d.e), inserted: d.ins }] : [];
}

/**
 * The alleles the fit found in a sample, as edits on the forward strand of the design reference (for the splice and AlphaGenome reviews of a clone).
 * A read from the reverse primer was fitted on the mirrored design: its alleles are turned back. Edits are relative to the control (a base the control itself
 * differs by from the reference is part of the reference here, not an edit).
 * @returns {Array<{ label: string, kind: string, size: number, fraction: number, edits: Array<{ start: number, end: number, ref: string, inserted: string, role: string }> }>}
 */
export function observedAlleles({ decomposition, prepared, spec, minFraction = 0.1, max = 4 }) {
  if (!decomposition || !prepared || !prepared.reference) return [];
  const rev = prepared.orientation === "-";
  const reference = String(rev ? rc(prepared.reference) : prepared.reference).toUpperCase();
  const markers = new Map((spec?.markers || []).map((m) => [m.pos, m]));
  const out = [];
  for (const c of decomposition.contributions || []) {
    if (c.kind === "wt" || c.kind === "noise" || c.fraction < minFraction || !c.sequence) continue;
    const allele = String(rev ? rc(c.sequence) : c.sequence).toUpperCase();
    const edits = editsBetween(reference, allele);
    if (!edits || !edits.length) continue;
    out.push({
      label: c.label, kind: c.kind, size: c.size ?? 0, fraction: Math.round(c.fraction * 1000) / 1000,
      // a base of a designed allele takes its role from the design (intended, blocking); the larger edit of a knock-in allele is the intended edit itself (a tag), the one of an indel allele is not
      edits: edits.map((e) => ({ ...e, role: e.end - e.start === 1 && e.inserted.length === 1 ? (markers.get(e.start)?.role || "other") : c.kind === "edit" ? "intended" : "indel" })),
    });
    if (out.length >= max) break;
  }
  return out;
}
