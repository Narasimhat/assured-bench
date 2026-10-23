// Which clones to carry forward, and in what order to confirm them.
//
// The decision (accept / hold / re-sequence / reject) says whether a result is reliable and what the genotype is. It cannot say which of several held clones to test first.
// This module ranks the clones of a run by how strongly the sequence predicts that no functional protein is left (the knockout support), and picks a short panel to
// take to the bench: the best clone of each distinct genotype, so that one failed mechanism does not take every candidate with it.
//
// The support is built from the same allele-level prediction as the functional call (coding.js). Each allele gets a risk that it still makes a functional protein,
// and the support of a clone is 100 x (1 - the share-weighted mean risk). The risks are ordinal weights set from the mechanism, not measured probabilities: they put a
// clean NMD-predicted frameshift above a truncation that escapes decay above a call that rests on splicing, and nothing short of a protein result reaches 100.
// `assured-qc calibrate` reports how often each class was borne out; replace the weights (options.risk) once that is known.
// Nothing here changes a decision. A protein result changes it only through applyObservations, with the reason written into the decision.

import { PROTEIN_WORDS, normalise } from "./calibration.js";

export const RISK_DEFAULTS = {
  lof_deleted: 0.05,        // every coding exon deleted
  lof_nmd: 0.15,            // premature stop, NMD predicted
  lof_nmd_borderline: 0.30, // the stop lies within ~20 nt of the 55-nt boundary, or the edit sits next to a splice site
  lof_start_loss: 0.30,     // start codon lost; a downstream ATG may restart
  lof_truncation: 0.40,     // truncated protein that lacks the marked domain but escapes NMD
  lof_other: 0.45,          // another predicted loss of function (for example an in-frame change that removes a marked region)
  uncertain: 0.70,          // the protein may well be made (in-frame, reinitiation, no stop, undecided splicing)
  not_lof: 0.95,            // synonymous, no coding effect, short in-frame change
  crypticSplice: 0.10,      // added to a splice-site loss: a cryptic site could give a third product
  maxSplice: 0.90,
};
// panel: clones to carry forward first; a knockout takes one per genotype (three), a wanted edit has replicates of one genotype (up to six)
export const RECOMMEND_DEFAULTS = { panel: 3, panelEdit: 6, minAllele: 0.05, risk: RISK_DEFAULTS };

const TIERS = [[0.2, "firm"], [0.35, "likely"], [0.55, "possible"], [Infinity, "unsupported"]];
const tierOf = (maxRisk) => TIERS.find(([limit]) => maxRisk <= limit)[1];
const TIER_TEXT = { firm: "every allele is a clean NMD-predicted loss", likely: "loss of function predicted, with a borderline NMD or splice-site caveat", possible: "loss of function depends on splicing or on a truncated product being inert", unsupported: "the protein is probably still made", confirmed: "protein absent on the blot" };

const outcomeRisk = (outcome, risk) => {
  if (!outcome) return risk.lof_splice ?? 0.5;
  if (!outcome.lof) return risk.uncertain;
  return risk[outcome.class] ?? risk.lof_other;
};

/** Risk that an allele still makes a functional protein, with a short phrase for the reasons. */
export function alleleRisk(row, riskTable = RISK_DEFAULTS) {
  const risk = { ...RISK_DEFAULTS, ...riskTable };
  if (!row || row.class === "wt") return { risk: 1, phrase: "wild type" };
  if (row.class === "lof_splice") {
    const splice = row.details && row.details.splice; const outcomes = splice ? [splice.skipping, splice.retention].filter(Boolean) : [];
    const base = outcomes.length ? Math.max(...outcomes.map((o) => outcomeRisk(o, risk))) : 0.4;
    const parts = []; if (splice && splice.skipping) parts.push(splice.skipping.class === "lof_truncation" ? "exon skipping gives a truncated product" : "exon skipping"); if (splice && splice.retention) parts.push(splice.retention.class === "lof_nmd" ? "intron retention gives a premature stop with NMD predicted" : "intron retention");
    return { risk: Math.min(risk.maxSplice, base + risk.crypticSplice), phrase: `splice-site loss${parts.length ? ` (${parts.join("; ")})` : ""}` };
  }
  if (row.lof) {
    if (row.class === "lof_nmd") { const d = row.details || {}; const borderline = (d.nmd && d.nmd.borderline) || d.nearSplice; return borderline ? { risk: risk.lof_nmd_borderline, phrase: `premature stop with NMD predicted, borderline${d.nearSplice ? " and next to a splice site" : ""}` } : { risk: risk.lof_nmd, phrase: "premature stop with NMD predicted" }; }
    const phrase = { lof_deleted: "all coding exons deleted", lof_start_loss: "start codon lost", lof_truncation: "truncated protein that lacks the marked domain, NMD not expected" }[row.class] || "predicted loss of function";
    return { risk: risk[row.class] ?? risk.lof_other, phrase };
  }
  if (["inframe", "synonymous", "no_coding_effect"].includes(row.class)) return { risk: risk.not_lof, phrase: "protein made with at most a small in-frame change" };
  return { risk: risk.uncertain, phrase: "the protein may still be made (undecided prediction)" };
}

const SPLICE_OR_NMD = (rows) => ({ splice: rows.some((r) => r.class === "lof_splice"), nmd: rows.some((r) => r.class === "lof_nmd") });

/** Score and basis for one analysed clone. */
export function supportOf(result, options = {}) {
  const opt = { ...RECOMMEND_DEFAULTS, ...options }; const workflow = result.workflow;
  const knock = workflow === "knockout" || workflow === "deletion";
  const fn = result.functional;
  if (knock && fn && fn.rows && fn.rows.length) {
    const rows = fn.rows.filter((r) => (r.fraction ?? 0) >= opt.minAllele || r.class === "wt"); const total = rows.reduce((s, r) => s + (r.fraction || 0), 0) || 1;
    const per = rows.map((r) => ({ label: r.label, share: (r.fraction || 0) / total, ...alleleRisk(r, opt.risk), class: r.class }));
    const mean = per.reduce((s, p) => s + p.share * p.risk, 0); const maxRisk = Math.max(...per.map((p) => p.risk));
    return { score: Math.round(100 * (1 - mean)), basis: "functional prediction from the gene record", tier: tierOf(maxRisk), alleles: per, mechanism: SPLICE_OR_NMD(rows) };
  }
  if (knock) {
    const s = result.summary || {}; const score = Math.max(0, Math.round(((s.koScorePct ?? 0) * (100 - (s.wtPct ?? 0))) / 100));
    return { score, basis: "KO score (frameshift or an indel of 21 bp or more, as in ICE; no gene record, so the effect on the protein is not modelled)", tier: score >= 90 ? "likely" : score >= 50 ? "possible" : "unsupported", alleles: [], mechanism: { splice: false, nmd: false } };
  }
  const iv = result.intervals || {}; const s = result.summary || {}; const score = Math.round(iv.intendedEditPct ? iv.intendedEditPct[0] : (s.intendedEditPct ?? 0));
  return { score, basis: "HDR score (intended edit), lower bound of the 95% interval", tier: score >= 85 ? "firm" : score >= 50 ? "likely" : score >= 20 ? "possible" : "unsupported", alleles: [], mechanism: { splice: false, nmd: false } };
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const CONF = { high: 0, moderate: 1, low: 2 };

/**
 * Rank the clones of a run and choose the panel to take forward.
 * @param {Array} results run results (one per sample, each with decision)
 * @returns {Array} one recommendation per result, in the order of `results`:
 *   { rank, score, basis, tier, tierText, priority, action, why, testWith, flags, group, groupOf, duplicateOf }
 *   priority: first | reserve | duplicate | caution (protein measured: truncated or reduced) | not_recommended (the sequence does not support the wanted edit) | resequence | discard | confirmed | none (not a clone)
 */
export function recommendClones(results, options = {}) {
  // an option that is undefined or null (for example --panel not given) must not replace a default
  const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== null));
  const opt = { ...RECOMMEND_DEFAULTS, ...given, risk: { ...RISK_DEFAULTS, ...(given.risk || {}) } };
  const info = results.map((r) => {
    if (!r || !r.ok || r.kind === "junction" || r.sampleType === "pool" || !r.decision) return null;
    const support = supportOf(r, opt); const confirmation = r.confirmation && r.confirmation.protein;
    const alleles = (r.genotype && r.genotype.alleles) || []; const label = (r.genotype && r.genotype.category ? `${r.genotype.category}: ` : "") + alleles.map((a) => a.label || `${a.kind} ${a.size}`).sort().join(" + ");
    const flags = [];
    if ((r.warnings || []).some((w) => /low quality scores/.test(w))) flags.push("low trace quality: sequence the other direction before relying on the allele resolution");
    if (r.ok && !r.reads) flags.push("one read only");
    else if (r.reads && r.reads.length === 1) flags.push("one read only");
    if (r.confidence && r.confidence.tier === "low") flags.push("low confidence in the edited share");
    const confirmed = confirmation === "absent"; const against = confirmation === "truncated" || confirmation === "reduced";
    // knockout clones with the same alleles share a predicted outcome (one mechanism), so the panel takes one per genotype; for a wanted edit (SNP, tag) clones of the same genotype are replicates and all count
    const knock = r.workflow === "knockout" || r.workflow === "deletion"; const unsupported = !confirmed && !against && support.tier === "unsupported";
    return { r, support, label, flags, confirmed, against, knock, unsupported, gkey: knock ? label : `sample:${r.name}`, quality: flags.some((f) => /trace quality/.test(f)) ? 1 : 0, nAlleles: alleles.length || 9 };
  });
  const panelSize = given.panel !== undefined ? given.panel : (info.some((x) => x && !x.knock) ? opt.panelEdit : opt.panel);
  // Without a gene record a knockout is ranked by its KO score (as ICE and DECODR report it: frameshift or an indel of 21 bp or more). Clones with the same deletion then tie on the score, so up to two of
  // them count towards the panel (independent clones with one deletion are a real replicate for a Western blot), ahead of a compound heterozygote; with a functional prediction one clone per genotype is enough.
  const koScoreRun = info.some((x) => x && x.knock && /^KO score/.test(x.support.basis)); const perGenotype = koScoreRun ? 2 : 1;
  const lowerBound = (x) => (x.r.intervals && x.r.intervals.koScorePct ? x.r.intervals.koScorePct[0] : 0);
  const out = results.map(() => ({ rank: null, score: null, basis: "", tier: "", tierText: "", priority: "none", action: "", why: [], testWith: [], flags: [], group: "", groupOf: 0, duplicateOf: null }));
  const eligible = []; 
  info.forEach((x, i) => {
    if (!x) return; const d = x.r.decision.decision;
    const base = out[i]; base.score = x.confirmed ? 100 : x.against ? Math.min(20, x.support.score) : x.support.score; base.basis = x.confirmed ? "protein absent on the blot, on top of the sequence prediction" : x.against ? `protein measured (${x.r.confirmation.protein}); the sequence prediction did not hold` : x.support.basis; base.tier = x.confirmed ? "confirmed" : x.against ? "unsupported" : x.support.tier; base.tierText = TIER_TEXT[base.tier] || ""; base.group = x.label; base.flags = x.flags;
    // the same allele can come as two library rows (a deletion slid along a repeat); one line per allele and mechanism, with its share
    const lines = new Map(); x.support.alleles.forEach((a) => { const key = `${a.label}: ${a.phrase}`; lines.set(key, (lines.get(key) || 0) + a.share); });
    base.why = [...lines].map(([key, share]) => (lines.size > 1 ? `${key} [${Math.round(share * 100)}% of the signal]` : key));
    const tests = []; if (x.r.workflow === "knockout" || x.r.workflow === "deletion") { tests.push("Western blot with an antibody outside the edited region (and a second antibody to another region)"); if (x.support.mechanism.splice) tests.push("RT-PCR across the flanking exons (exon skipped, intron retained or cryptic site)"); if (x.support.mechanism.nmd) tests.push("RT-qPCR downstream of the stop to see the transcript fall"); }
    base.testWith = x.confirmed ? [] : tests;
    if (d === "reject") { base.priority = "discard"; base.action = "Discard: the result does not carry the wanted edit."; return; }
    if (d === "re-sequence") { base.priority = "resequence"; base.action = "Sequence again before anything else; the current trace cannot settle it."; return; }
    if (x.unsupported) { base.priority = "not_recommended"; base.action = x.knock ? "Not recommended: the sequence does not predict loss of the protein (a wild-type or protein-making allele is present)." : "Not recommended: the sequence does not support the wanted edit (support under 20)."; return; }
    eligible.push(i);
  });
  eligible.sort((a, b) => { const x = info[a]; const y = info[b];
    return (y.confirmed - x.confirmed) || (x.against - y.against) || (out[b].score - out[a].score) || (x.nAlleles - y.nAlleles) || (x.quality - y.quality) || ((CONF[x.r.confidence?.tier] ?? 1) - (CONF[y.r.confidence?.tier] ?? 1)) || (koScoreRun ? lowerBound(y) - lowerBound(x) : 0) || natural(x.r.name, y.r.name); });
  const seen = new Map(); let reps = 0;
  eligible.forEach((i, k) => {
    const x = info[i]; const o = out[i]; o.rank = k + 1;
    if (x.confirmed) { o.priority = "confirmed"; o.action = "Protein absent: use this clone. Consider a second antibody to another region, and out-out PCR for a large deletion on the other allele."; if (!seen.has(x.gkey)) seen.set(x.gkey, { i, n: 1 }); return; }
    if (x.against) { o.priority = "caution"; o.action = `Protein measured (${x.r.confirmation.protein}): a protein is still made. Test whether it is functional, or choose another clone.`; return; }
    const prior = seen.get(x.gkey); const cap = x.knock ? perGenotype : 1;
    if (prior && prior.n >= cap) { o.priority = "duplicate"; o.duplicateOf = info[prior.i].r.name; o.action = `Same genotype as ${info[prior.i].r.name}: keep as a backup, test only if ${cap > 1 ? "one of those clones" : "that clone"} fails.`; return; }
    if (prior) prior.n += 1; else seen.set(x.gkey, { i, n: 1 });
    reps += 1; const accepted = x.r.decision.decision === "accept";
    if (reps <= panelSize) { o.priority = "first"; o.action = x.knock ? (prior ? `Carry forward: a second clone with the same deletion as ${info[prior.i].r.name}, an independent check.` : (accepted ? (koScoreRun ? "Carry forward to the Western blot." : "Carry forward; confirm the protein as routine.") : "Carry forward and test first (best clone of its genotype).")) : (accepted ? "Carry forward: one of the best clones carrying the wanted edit." : "Carry forward after checking the flagged points (see the reasons): the genotype is usable but not the cleanest."); }
    else { o.priority = "reserve"; o.action = x.knock ? "Reserve: test if the first-choice clones fail." : "Reserve: the next best clone carrying the wanted edit; use it if a first-choice clone fails."; }
  });
  const sizeOf = new Map(); info.forEach((x) => { if (x) sizeOf.set(x.gkey, (sizeOf.get(x.gkey) || 0) + 1); }); info.forEach((x, i) => { if (x) out[i].groupOf = sizeOf.get(x.gkey); });
  return out;
}

/** Attach recommendations to the results (a new array; the results are not modified otherwise). */
export function withRecommendations(results, options = {}) { const recs = recommendClones(results, options); return results.map((r, i) => ({ ...r, recommendation: recs[i] })); }

/** The panel in rank order: names of the clones to take forward first. */
export const panelOf = (results) => results.filter((r) => r.recommendation && ["first", "confirmed"].includes(r.recommendation.priority)).sort((a, b) => a.recommendation.rank - b.recommendation.rank).map((r) => r.name);

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function recommendationCsv(results) {
  const header = ["rank", "sample", "well", "decision", "priority", "knockout_support", "support_tier", "support_basis", "genotype", "action", "why", "test_with", "flags", "same_genotype_as"];
  const rows = results.filter((r) => r.recommendation && r.recommendation.priority !== "none").slice().sort((a, b) => (a.recommendation.rank ?? 1e6) - (b.recommendation.rank ?? 1e6) || natural(a.name, b.name));
  return `${[header.join(","), ...rows.map((r) => { const c = r.recommendation; return [c.rank ?? "", r.name, r.well || "", r.decision.decision, c.priority, c.score ?? "", c.tier, c.basis, c.group, c.action, c.why.join(" | "), c.testWith.join(" | "), c.flags.join(" | "), c.duplicateOf || ""].map(csvCell).join(","); })].join("\n")}\n`;
}

// ---- protein results -------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Apply protein (and RNA) results from the bench to a knockout run. Only knockout and deletion samples with a protein result change:
 *   absent     accept when the sequence shows no wild type (edited at least 90%, wild type at most 10%); otherwise the decision stays and the result is noted
 *   present    reject: the protein is still made, whatever the sequence predicts
 *   truncated  hold: a shorter product is made; its function has to be tested
 *   reduced    hold
 * The earlier decision is kept in decision.before. A result that is `absent` with an antibody whose epitope lies in the edited region says nothing: use an antibody outside it.
 */
export function applyObservations(results, observations, options = {}) {
  const koMinEdited = options.koMinEdited ?? 90; const wtMax = options.wtMaxForKo ?? 10; const problems = []; const byName = new Map(results.map((r) => [r.name, r]));
  const matched = new Map();
  observations.forEach((o) => {
    const name = String(o.sample || "").trim(); const r = byName.get(name) || results.find((x) => x.name && name && (x.name.startsWith(name) || name.startsWith(x.name)));
    if (!r) { problems.push(`${name}: not in the run results.`); return; }
    const protein = normalise(o.protein, PROTEIN_WORDS);
    if (protein === null) { problems.push(`${name}: no protein result.`); return; }
    if (protein === "unrecognised") { problems.push(`${name}: protein result "${o.protein}" is not absent, reduced, present or truncated.`); return; }
    matched.set(r.name, { protein, rna: o.rna || "", note: o.notes || o.antibody || "" });
  });
  const updated = results.map((r) => {
    const obs = matched.get(r.name); if (!obs) return r;
    const knock = r.workflow === "knockout" || r.workflow === "deletion"; const confirmation = { protein: obs.protein, rna: obs.rna, note: obs.note };
    if (!r.ok || !knock) return { ...r, confirmation };
    const iv = r.intervals; const s = r.summary; const lowEdited = iv ? iv.editedPct[0] : s.editedPct; const highWt = iv ? iv.wtPct[1] : s.wtPct; const before = r.decision;
    const sequenceKo = lowEdited >= koMinEdited && highWt <= wtMax; const where = obs.note ? ` (${obs.note})` : "";
    const base = (before.reasons || []).slice(0, 2);
    let decision = before;
    if (obs.protein === "absent") decision = sequenceKo && before.decision !== "reject" && before.decision !== "re-sequence" ? { decision: "accept", reasons: [...base, `Protein absent on the blot${where}.`], next: "Use this clone. A second antibody to another region, and out-out PCR for a large deletion on the other allele, close the remaining gaps.", before } : { ...before, reasons: [...before.reasons, `Protein absent on the blot${where}, but the sequence does not show a clean knockout.`] };
    else if (obs.protein === "present") decision = { decision: "reject", reasons: [...base, `Protein still detected${where}: the predicted loss of function did not hold.`], next: "Discard, or check that the antibody epitope lies outside the edited region and that the band is not a cross-reaction.", before };
    else if (obs.protein === "truncated") decision = { decision: "hold", reasons: [...base, `A shorter product is made${where}.`], next: "Test whether the truncated protein is functional (for example a pathway readout) before using the clone.", before };
    else decision = { decision: "hold", reasons: [...base, `Protein reduced, not absent${where}.`], next: "Choose another clone or repeat with a second antibody.", before };
    return { ...r, confirmation, decision };
  });
  return { results: updated, problems, matched: matched.size };
}
