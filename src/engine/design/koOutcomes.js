// Knockout confidence for a guide: what its typical indels do to the protein, not only to the reading frame.
//
// Until now a knockout design was judged by geometry (non-terminal exon, two guides 40-140 bp apart, GC, opposite strands) and by
// whether the nominal deletion between the cuts is a frameshift. That says nothing about whether the cell makes the protein anyway.
// The DIPK2A pair chosen this way put one guide 63 nt before the last exon junction: every frameshift it makes ends within the NMD-escape
// window, the cells keep about 70% of the protein as a stable truncation, and a Western blot shows it while the ICE knockout score reads
// 100%. This module simulates a panel of indels at each cut, splices them into the coding sequence, finds the premature stop and applies
// the same exon-junction rules, thresholds and classes as the Assured QC engine (coding.js), so a design is ranked by the outcome the
// clone screen will later predict. It is a prediction from sequence; a protein assay is what confirms a knockout.
//
// NMD rules (Nagy and Maquat 1998; Lindeboom et al. 2016, 2019): no decay for a stop in the last coding exon, within 55 nt of the last
// junction, within 150 nt of the start codon, or in a coding exon longer than 407 nt. These rules fail for roughly a third of premature
// stops, so a stop only 56 to 75 nt upstream is called "borderline".
//
// Free of React and of Vite-only globals so `node --test` can load it.

export const KO_RULES = Object.freeze({
  lastJunction: 55, borderline: 20, startProximal: 150, longExon: 407,
  truncationLof: 0.5, reinitMaxPtc: 300, reinitMinRetained: 0.6,
});

/** Frameshift indels simulated at every cut: deletions of these sizes (at every placement that spans the cut), and 1- and 2-base insertions (all bases). */
export const KO_PANEL = Object.freeze({ deletions: [1, 2, 4, 5, 7, 8, 10], insertions: [1, 2] });

/** Lower is better. */
export const KO_TIER_RANK = Object.freeze({ robust: 0, marginal: 1, truncation: 2, escape: 3, unmodelled: 4 });

const AA = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const IDX = { T: 0, C: 1, A: 2, G: 3 };
const codonAa = (c) => { const a = IDX[c[0]]; const b = IDX[c[1]]; const d = IDX[c[2]]; return a === undefined || b === undefined || d === undefined ? "X" : AA[a * 16 + b * 4 + d]; };

function firstStop(seq) {
  for (let i = 0; i + 3 <= seq.length; i += 3) if (codonAa(seq.slice(i, i + 3)) === "*") return i;
  return -1;
}

/**
 * Splice an edit into the coding sequence without copying the genomic sequence (only the one segment it falls in is rebuilt).
 * Returns { noEffect: true } for an edit clear of every coding segment, null for one that touches or abuts a segment boundary (a splice site),
 * else the mutated coding sequence with the segment lengths and exon junctions in coding coordinates.
 */
export function spliceEdit(model, edit) {
  const segs = model.cdsSegments; const { s, e, ins = "" } = edit; const delta = ins.length - (e - s);
  const lens = segs.map(([a, b]) => b - a);
  const starts = []; { let run = 0; lens.forEach((len) => { starts.push(run); run += len; }); }
  const native = model.cdsSequence;
  const parts = () => segs.map(([a], i) => native.slice(starts[i], starts[i] + lens[i]));
  // a deletion that runs from before the coding sequence into its first segment removes the start codon
  if (s <= segs[0][0] && e > segs[0][0] && e < segs[0][1] && !ins) {
    const rest = parts(); rest[0] = rest[0].slice(e - segs[0][0]);
    return { startLoss: true, cds: rest.join(""), lens: rest.map((part) => part.length), delta };
  }
  const inside = segs.findIndex(([a, b]) => a < s && e < b);
  if (inside < 0) {
    const near = segs.some(([a, b]) => s <= b && e >= a);
    return near ? null : { noEffect: true };
  }
  const p = parts(); const a0 = segs[inside][0];
  p[inside] = p[inside].slice(0, s - a0) + ins + p[inside].slice(e - a0);
  const lens2 = p.map((part) => part.length);
  const junctions = []; let run = 0; lens2.slice(0, -1).forEach((len) => { run += len; junctions.push(run); });
  return { cds: p.join(""), lens: lens2, junctions, delta, cEnd: starts[inside] + (e - a0) };
}

function nmdCall(ptcNt, junctions, lens, opt) {
  if (!junctions.length) return { predicted: false, rule: "single coding exon: no exon junction downstream, NMD not expected" };
  const last = junctions[junctions.length - 1];
  if (ptcNt >= last) return { predicted: false, rule: "stop in the last coding exon: NMD not expected", margin: last - ptcNt };
  if (last - ptcNt <= opt.lastJunction) return { predicted: false, rule: `stop ${last - ptcNt} nt before the last exon junction (50-55 nt rule): NMD not expected`, margin: last - ptcNt };
  if (ptcNt <= opt.startProximal) return { predicted: false, uncertain: true, rule: `stop within ${opt.startProximal} nt of the start codon: NMD is often inefficient`, margin: last - ptcNt };
  let from = 0; let exonLen = 0;
  for (const len of lens) { if (ptcNt < from + len) { exonLen = len; break; } from += len; }
  if (exonLen > opt.longExon) return { predicted: false, uncertain: true, rule: `stop in a coding exon of ${exonLen} nt (long-exon rule): NMD partly evaded`, margin: last - ptcNt };
  return { predicted: true, borderline: last - ptcNt <= opt.lastJunction + opt.borderline, rule: `stop ${last - ptcNt} nt upstream of the last exon junction: NMD expected`, margin: last - ptcNt };
}

/**
 * Class of one edit on the coding sequence, in the Assured QC vocabulary:
 * lof_nmd | truncation_reinit_uncertain | lof_truncation | truncation_uncertain | inframe | frameshift_no_stop | unmodelled
 */
export function classifyEdit(model, edit, options = {}) {
  const opt = { ...KO_RULES, ...options };
  const protLen = model.proteinLength || (model.cdsSequence.length / 3 - 1);
  const sp = spliceEdit(model, edit);
  if (!sp) return { class: "unmodelled", lof: null, note: "The edit touches a splice site; exon skipping or intron retention is not simulated here." };
  if (sp.noEffect) return { class: "no_coding_effect", lof: false };
  if (sp.startLoss) {
    const at = sp.cds.indexOf("ATG");
    if (at < 0) return { class: "lof_start_loss", lof: true, delta: sp.delta };
    const orf = sp.cds.slice(at); const stop = firstStop(orf);
    const nativeEnd = stop === orf.length - 3 && orf.length % 3 === 0;
    const retained = stop < 0 ? null : (stop / 3 + 1) / protLen;
    if (nativeEnd && retained !== null && retained >= opt.reinitMinRetained) return { class: "start_loss_uncertain", lof: null, delta: sp.delta, retainedPct: Math.round(retained * 1000) / 10 };
    return { class: "lof_start_loss", lof: true, delta: sp.delta };
  }
  const frame = sp.delta % 3 === 0;
  const stopNt = firstStop(sp.cds);
  const normalEnd = sp.cds.length % 3 === 0 && stopNt === sp.cds.length - 3;
  if (stopNt < 0) return { class: "frameshift_no_stop", lof: null, delta: sp.delta };
  if (normalEnd) return frame ? { class: "inframe", lof: null, delta: sp.delta } : { class: "frameshift_no_stop", lof: null, delta: sp.delta };
  const retained = Math.min(1, stopNt / 3 / protLen);
  const nmd = nmdCall(stopNt, sp.junctions, sp.lens, opt);
  const base = { delta: sp.delta, stopNt, ptcAa: Math.round(stopNt / 3), retainedPct: Math.round(retained * 1000) / 10, nmd };
  // a downstream in-frame ATG (native frame, past the edit) can restart translation after an early stop
  let reinit = null;
  if (stopNt <= opt.reinitMaxPtc) {
    const native = model.cdsSequence;
    for (let o = Math.ceil(sp.cEnd / 3) * 3; o + 3 <= native.length; o += 3) if (native.startsWith("ATG", o)) { reinit = { aa: o / 3 + 1, retainedPct: Math.round(((native.length - o) / native.length) * 1000) / 10 }; break; }
  }
  const reinitRisk = reinit && reinit.retainedPct >= opt.reinitMinRetained * 100;
  if (nmd.predicted && !reinitRisk) return { ...base, class: "lof_nmd", lof: true };
  if (reinitRisk) return { ...base, class: "truncation_reinit_uncertain", lof: null, reinit };
  if (retained < opt.truncationLof) return { ...base, class: "lof_truncation", lof: true };
  return { ...base, class: "truncation_uncertain", lof: null };
}

const altCache = new WeakMap();
const parseJoin = (loc) => { const m = [...String(loc).matchAll(/(\d+)\.\.(\d+)/g)]; return m.length ? m.map((x) => [Number(x[1]) - 1, Number(x[2])]).sort((l, r) => l[0] - r[0]) : null; };

/** The coding sequences of the record to hold a design against: the model's own CDS first, then every other CDS feature of the same gene (at most 8). */
export function codingModels(model) {
  if (altCache.has(model)) return altCache.get(model);
  const out = [{ id: model.transcriptId || model.gene || "main", model }];
  const mainKey = JSON.stringify(model.cdsSegments);
  for (const f of (Array.isArray(model.rawFeatures) ? model.rawFeatures : [])) {
    if (out.length >= 8) break;
    if (f.type !== "CDS" || !f.loc || /complement/.test(f.loc)) continue;
    const gene = f.q && f.q.gene; if (gene && model.gene && String(gene).toLowerCase() !== String(model.gene).toLowerCase()) continue;
    const segs = parseJoin(f.loc); if (!segs || JSON.stringify(segs) === mainKey) continue;
    const cds = segs.map(([a, b]) => model.genomicSequence.slice(a, b)).join("");
    if (cds.length % 3 !== 0 || cds.length < 6) continue;
    out.push({ id: (f.q && (f.q.transcript_id || f.q.protein_id)) || `CDS${out.length + 1}`, model: { cdsSegments: segs, cdsSequence: cds, genomicSequence: model.genomicSequence, proteinLength: cds.length / 3 - 1 } });
  }
  altCache.set(model, out); return out;
}

// how far from a clean null an outcome is: used to decide whether an annotated isoform other than the main one is disrupted
const LOF_CLASSES = new Set(["lof_nmd", "lof_start_loss", "lof_truncation"]);

/**
 * classifyEdit on the main coding sequence (this is what the tier is graded on, as the Assured QC engine does) and, separately, on every other
 * annotated coding sequence of the same gene in the record: `gaps` lists the isoforms in which the edit is not a predicted loss of function.
 */
export function classifyEditAcrossIsoforms(model, edit, options = {}) {
  const [main, ...others] = codingModels(model);
  const result = classifyEdit(main.model, edit, options);
  const gaps = others.map(({ id, model: m }) => ({ id, ...classifyEdit(m, edit, options) })).filter((x) => !LOF_CLASSES.has(x.class)).map((x) => ({ id: x.id, class: x.class }));
  return { ...result, isoformsEvaluated: 1 + others.length, gaps };
}

function outcomeLabel(kind, size, bases) { return kind === "del" ? `-${size} bp` : `+${size} bp${bases ? ` (${bases})` : ""}`; }

/** Every distinct indel of the panel at a cut (a deletion at every placement that spans or abuts the cut; insertions with every base combination). */
export function panelEdits(cut, panel = KO_PANEL) {
  const edits = [];
  for (const n of panel.deletions) for (let s = cut - n; s <= cut; s += 1) edits.push({ s, e: s + n, ins: "", label: outcomeLabel("del", n) });
  for (const n of panel.insertions) for (let k = 0; k < 4 ** n; k += 1) { let ins = ""; for (let j = 0, x = k; j < n; j += 1, x = Math.floor(x / 4)) ins += "ACGT"[x % 4]; edits.push({ s: cut, e: cut, ins, label: outcomeLabel("ins", n, ins) }); }
  return edits;
}

const cleanNull = (o) => o.class === "lof_start_loss" || (o.class === "lof_nmd" && !(o.nmd && o.nmd.borderline));
function tierOf(outcomes) {
  if (outcomes.some((o) => o.class === "unmodelled")) return "unmodelled";
  if (outcomes.every(cleanNull)) return "robust";
  if (outcomes.every((o) => o.class === "lof_nmd" || o.class === "lof_start_loss")) return "marginal";
  if (outcomes.every((o) => o.class === "lof_nmd" || o.class === "lof_start_loss" || o.class === "lof_truncation")) return "truncation";
  return "escape";
}

const share = (list, pred) => (list.length ? Math.round((list.filter(pred).length / list.length) * 100) : 0);

/**
 * Knockout confidence of one guide (cut = interbase index into the model's genomic sequence, as `guide.cut`).
 * tier: robust (every frameshift is NMD-predicted by a clear margin) < marginal (all NMD-predicted, some borderline) < truncation (some
 * escape NMD but the truncated protein is short enough to be called loss of function) < escape (some outcomes make a stable or long protein).
 */
const guideCache = new WeakMap();
export function assessKoGuide(model, guide, options = {}) {
  const useCache = !options.panel && !Object.keys(options).length;
  if (useCache) { const hit = guideCache.get(model) && guideCache.get(model).get(guide.cut); if (hit) return hit; }
  const result = computeKoGuide(model, guide, options);
  if (useCache) { if (!guideCache.has(model)) guideCache.set(model, new Map()); guideCache.get(model).set(guide.cut, result); }
  return result;
}

function computeKoGuide(model, guide, options) {
  const edits = panelEdits(guide.cut, options.panel);
  const outcomes = edits.map((edit) => ({ label: edit.label, ...classifyEditAcrossIsoforms(model, edit, options) }));
  const tier = tierOf(outcomes);
  const isoformsEvaluated = outcomes.length ? outcomes[0].isoformsEvaluated : 1;
  const gapIds = {}; outcomes.forEach((o) => (o.gaps || []).forEach((gap) => { gapIds[gap.id] = (gapIds[gap.id] || 0) + 1; }));
  const isoformGaps = Object.entries(gapIds).map(([id, n]) => ({ id, nonLofPct: Math.round((n / outcomes.length) * 100) }));
  const margins = outcomes.map((o) => o.nmd && o.nmd.margin).filter(Number.isFinite);
  const retained = outcomes.map((o) => o.retainedPct).filter(Number.isFinite);
  const escaping = outcomes.filter((o) => o.class !== "lof_nmd");
  const reasons = [];
  if (tier === "escape" || tier === "truncation") {
    const worst = escaping.slice().sort((a, b) => (b.retainedPct || 0) - (a.retainedPct || 0))[0];
    reasons.push(`${share(outcomes, (o) => o.class !== "lof_nmd")}% of simulated frameshifts are not predicted to trigger NMD${worst && Number.isFinite(worst.retainedPct) ? `; the longest keeps ${worst.retainedPct}% of the protein (${worst.label}, stop ${worst.nmd && worst.nmd.margin} nt from the last exon junction)` : ""}.`);
  } else if (tier === "marginal") {
    reasons.push(`${share(outcomes, (o) => o.nmd && o.nmd.borderline)}% of simulated frameshifts stop within ${KO_RULES.lastJunction + KO_RULES.borderline} nt of the last exon junction, where NMD is less certain.`);
  } else if (tier === "unmodelled") reasons.push("Some simulated edits touch a splice site; their effect is not modelled.");
  const isoformNote = isoformGaps.length ? `${isoformGaps.length} of ${isoformsEvaluated - 1} other annotated coding sequence${isoformsEvaluated - 1 === 1 ? "" : "s"} of this gene in the record (${isoformGaps.map((g) => g.id).join(", ")}) ${isoformGaps.length === 1 ? "is" : "are"} not disrupted by every simulated edit at this cut.` : "";
  return {
    cut: guide.cut, tier, outcomes: outcomes.length,
    robustPct: share(outcomes, (o) => o.class === "lof_nmd" && !(o.nmd && o.nmd.borderline)),
    marginalPct: share(outcomes, (o) => o.class === "lof_nmd" && o.nmd && o.nmd.borderline),
    escapePct: share(outcomes, (o) => o.class !== "lof_nmd" && o.class !== "lof_truncation" && o.class !== "lof_start_loss"),
    isoforms: { evaluated: isoformsEvaluated, gaps: isoformGaps },
    isoformNote,
    minMarginNt: margins.length ? Math.min(...margins) : null,
    maxRetainedPct: retained.length ? Math.max(...retained) : null,
    reasons,
  };
}

/** Knockout confidence of a pair: each guide on its own (either can act alone) and the deletion between the two cuts. */
export function assessKoPair(model, left, right, options = {}) {
  const a = assessKoGuide(model, left, options); const b = assessKoGuide(model, right, options);
  const s = Math.min(left.cut, right.cut); const e = Math.max(left.cut, right.cut);
  const between = classifyEditAcrossIsoforms(model, { s, e, ins: "" }, options);
  const betweenTier = between.class === "lof_nmd" || between.class === "lof_start_loss" ? (between.nmd && between.nmd.borderline ? "marginal" : "robust")
    : between.class === "lof_truncation" ? "truncation" : between.class === "unmodelled" ? "unmodelled" : "escape";
  const worst = [a.tier, b.tier, betweenTier].sort((x, y) => KO_TIER_RANK[y] - KO_TIER_RANK[x])[0];
  // each guide can act alone, so an isoform's gap is the larger of the two guides' gaps; the deletion between the cuts adds its own all-or-nothing gap
  const gapPct = {}; [...a.isoforms.gaps, ...b.isoforms.gaps].forEach((g) => { gapPct[g.id] = Math.max(gapPct[g.id] || 0, g.nonLofPct); });
  (between.gaps || []).forEach((g) => { gapPct[g.id] = Math.max(gapPct[g.id] || 0, 100); });
  const gapIds = Object.keys(gapPct);
  const isoformGapScore = Object.values(gapPct).reduce((sum, v) => sum + v, 0);
  const reasons = [...a.reasons.map((r) => `Guide 1: ${r}`), ...b.reasons.map((r) => `Guide 2: ${r}`)];
  if (betweenTier === "escape" || betweenTier === "truncation") reasons.push(`The deletion between the cuts (${e - s} bp) is ${between.class === "inframe" ? "in frame" : between.nmd ? between.nmd.rule : "not predicted to lose function"}.`);
  const isoformNote = gapIds.length ? `Isoform coverage: ${gapIds.join(", ")} ${gapIds.length === 1 ? "is" : "are"} not disrupted by every edit this pair can make; the main transcript is what the tier is graded on.` : "";
  return { tier: worst, isoformGaps: gapIds, isoformGapScore, isoformNote, guides: [a, b], between: { sizeBp: e - s, class: between.class, tier: betweenTier, nmd: between.nmd ? between.nmd.rule : null, retainedPct: between.retainedPct ?? null }, reasons };
}

/** Plain-language line for the report and the review list. */
export function describeKoTier(tier) {
  return ({
    robust: "Every simulated frameshift is predicted to trigger nonsense-mediated decay by a clear margin.",
    marginal: "Simulated frameshifts are predicted to trigger NMD, but some stop close to the 55-nt boundary of the rule, where the prediction is less certain.",
    truncation: "Some simulated frameshifts escape NMD; the truncated protein is short enough to be called loss of function, but a protein assay is needed.",
    escape: "Some simulated frameshifts are predicted to escape NMD and leave a long truncated protein, so the protein may still be made despite a frameshift.",
    unmodelled: "Some simulated edits touch a splice site; their effect is not modelled.",
  })[tier] || "";
}
