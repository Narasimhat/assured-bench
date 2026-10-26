// Sequence-supported knockout selection. Scores are evidence components, not probabilities
// of experimental success. Missing external evidence never counts as a passed check.
import { assessKoGuide, assessKoPair, codingModels, KO_TIER_RANK } from "./koOutcomes.js";
import { assessEnzymeGuide } from "./enzymeGuides.js";
import { getEnzyme } from "./enzymeConfig.js";

export const KO_SELECTION_VERSION = "3.0.0";

/** What no knockout design in this tool assesses, whatever way its pair was chosen. A design is never "ready" while these stand. */
export const KO_UNASSESSED = Object.freeze(["Cell-specific isoform expression", "Essential-domain disruption", "Sample variants and copy number (the cell line's own variants at the guide, PAM and primer sites)", "Genome-wide off-target specificity", "Calibrated cutting efficiency (the GC penalty is a coarse proxy, not a model of it)", "Thermodynamic RNA folding", "Neighboring regulatory effects and rearrangement risk"]);

// GC content of the spacer enters the ranking as a penalty, in predicted-LoF percentage points, and excludes only the extremes.
// Evidence: guides with very low (<=35%) or very high (>80%) overall GC are less active (Wang 2014, Doench 2014 as summarised in Cell Rep 2019;
// sgDesigner 2020: most guides above 80% or below 30% non-functional); one independent dataset found only a minor, non-significant gain for 41-70%
// over <40% or >70% (Labuhn 2018). A strict 40-60% window excluded guides with the highest predicted loss of function. The step size is 5 points because that is the finest difference the repair-outcome
// predictor resolves (its own test-set correlation is 0.71); the penalty sizes themselves are not calibrated and are to be replaced by data.
export const GC_POLICY = Object.freeze({ excludeBelow: 30, excludeAbove: 80, bands: Object.freeze([
  { label: "40-60%", points: 0 }, { label: "35-40% or 60-70%", points: 5 }, { label: "30-35% or 70-80%", points: 10 },
]) });
export function gcPenaltyPoints(gc, scale = 1) {
  if (!Number.isFinite(gc) || gc < GC_POLICY.excludeBelow || gc > GC_POLICY.excludeAbove) return Infinity;
  if (gc >= 40 && gc <= 60) return 0;
  return scale * ((gc > 35 && gc < 40) || (gc > 60 && gc <= 70) ? 5 : 10);
}
const PAIR_SHORTLIST = 32;
const sequenceOf = guide => String(guide.sp || guide.spacer || "").toUpperCase();
const keyOf = guide => `${guide.str || guide.strand}:${guide.cut}:${sequenceOf(guide)}`;
export function assessKoEligibility(guide, { enzyme = "spcas9", delivery = "rnp" } = {}) {
  const spacer = sequenceOf(guide);
  const gc = spacer.length ? 100 * [...spacer].filter(base => /[GC]/.test(base)).length / spacer.length : NaN;
  const qc = assessEnzymeGuide({ ...guide, spacer, gc }, getEnzyme(enzyme), {
    delivery, filters: { gc_min: GC_POLICY.excludeBelow, gc_max: GC_POLICY.excludeAbove, self_complement_length: 0 },
  });
  if (!/^[ACGT]+$/.test(spacer)) qc.reasons.push("invalid_spacer");
  return { ...qc, passed: qc.reasons.length === 0, gc, gcPenaltyPts: gcPenaltyPoints(gc) };
}

const inside = (model, cut) => model.cdsSegments.find(([start, end]) => start < cut && cut < end);
// One ordering for single guides, used for the pair search, the backups and the ranking table of the Co-Scientist panel.
// Coding coverage, then functional tier, then (when a pan-isoform analysis supplied common exons) whether the guide cuts one, then (when transcript
// annotations were supplied) the share of annotated coding transcripts that contain the cut, then isoform escape, then predicted LoF after the GC penalty
// in 5-point steps, then the remaining sequence flags. The transcript share is a separate key, not a multiplier on LoF: a multiplier mixes a fraction with
// the GC penalty in LoF points and changes the order of guides that all share the same coverage. As a key, equal coverage leaves the order unchanged and
// a guide whose cut lies in more transcripts wins (equal transcript weights are an assumption; an isoform that skips the exon cannot be reached by any
// guide in it, and counts against all of them alike).
const effectiveLof = row => (row.outcomes?.lofPct ?? 0) - row.gcPenaltyPts;
const effectiveLofBin = row => Math.floor(effectiveLof(row) / 5);
const coverageStep = row => (Number.isFinite(row.cutCoverage) ? Math.round(row.cutCoverage * 1e6) : 0);
const makeCompareRows = common => (a, b) => b.coveredIsoforms - a.coveredIsoforms
  || KO_TIER_RANK[a.assessment.tier] - KO_TIER_RANK[b.assessment.tier]
  || (common ? Number(!a.inCommonExon) - Number(!b.inCommonExon) : 0)
  || coverageStep(b) - coverageStep(a)
  || a.assessment.isoforms.gaps.reduce((n, g) => n + g.nonLofPct, 0) - b.assessment.isoforms.gaps.reduce((n, g) => n + g.nonLofPct, 0)
  || effectiveLofBin(b) - effectiveLofBin(a)
  || Number(a.exonSkippingInFrame) - Number(b.exonSkippingInFrame)
  || Number(a.selfComplementarityFlag) - Number(b.selfComplementarityFlag)
  || b.spliceMargin - a.spliceMargin
  || Math.abs(a.gc - 50) - Math.abs(b.gc - 50)
  || a.guide.cut - b.guide.cut || keyOf(a.guide).localeCompare(keyOf(b.guide));

function publicRow(row) {
  return { rank: row.rank, spacer: sequenceOf(row.guide), strand: row.guide.str || row.guide.strand,
    pam: row.guide.pam, cut: row.guide.cut, gc: row.gc, tier: row.assessment.tier,
    coveredIsoforms: row.coveredIsoforms, isoformsEvaluated: row.isoformsEvaluated,
    isoformGaps: row.assessment.isoforms.gaps, isoformNote: row.assessment.isoformNote,
    spliceMargin: row.spliceMargin, exonSkippingInFrame: row.exonSkippingInFrame,
    selfComplementarityFlag: row.selfComplementarityFlag,
    gcPenaltyPts: row.gcPenaltyPts, effectiveLofPct: row.outcomes ? Math.round(effectiveLof(row) * 10) / 10 : null,
    ...(row.cutCoverage === undefined ? {} : { isoformCoveragePct: Math.round(row.cutCoverage * 1000) / 10 }),
    ...(row.inCommonExon === undefined ? {} : { inCommonExon: row.inCommonExon }),
    outcomes: row.outcomes, reasons: row.assessment.reasons,
    qualification: "Frameshift-panel tier is conditional on a frameshift; it is not cutting efficiency or knockout probability." };
}

/** Rank all eligible single guides, then examine combinations of a bounded, declared shortlist.
 * Common coding coverage is required across the usable CDS annotations supplied in this record.
 * Expression, domains, variants and genome-wide specificity are not inferred from absent data.
 */
export function rankKoSingles(model, candidates, { enzyme = "spcas9", delivery = "rnp", koScorer = null, commonKoExons = null, gcPenaltyScale = 1, cutCoverage = null } = {}) {
  const isoforms = codingModels(model);
  const common = Array.isArray(commonKoExons) && commonKoExons.length ? new Set(commonKoExons) : null;
  const seen = new Set(); let qualityRejected = 0; let coverageRejected = 0; let spliceBoundaryRejected = 0;
  const rows = [];
  for (const guide of candidates) {
    const key = keyOf(guide); if (seen.has(key)) continue; seen.add(key);
    const quality = assessKoEligibility(guide, { enzyme, delivery });
    if (!quality.passed) { qualityRejected += 1; continue; }
    const segments = isoforms.map(entry => inside(entry.model, guide.cut));
    const coveredIsoforms = segments.filter(Boolean).length;
    if (coveredIsoforms !== isoforms.length) { coverageRejected += 1; continue; }
    const spliceMargin = Math.min(...segments.map(([a, b]) => Math.min(guide.cut - a, b - guide.cut)));
    if (spliceMargin <= 10) { spliceBoundaryRejected += 1; continue; }
    const exonIndex = model.cdsSegments.findIndex(([a, b]) => a < guide.cut && guide.cut < b) + 1;
    rows.push({ guide, gc: quality.gc, gcPenaltyPts: gcPenaltyPoints(quality.gc, gcPenaltyScale), coveredIsoforms, isoformsEvaluated: isoforms.length,
      exonIndex, ...(common ? { inCommonExon: common.has(exonIndex) } : {}),
      ...(typeof cutCoverage === "function" ? (() => { const f = cutCoverage(guide.cut); return Number.isFinite(f) ? { cutCoverage: f } : {}; })() : {}),
      spliceMargin, exonSkippingInFrame: segments.some(([a, b]) => (b - a) % 3 === 0),
      selfComplementarityFlag: assessEnzymeGuide({ ...guide, spacer: sequenceOf(guide), gc: quality.gc }, getEnzyme(enzyme), { delivery }).reasons.includes("self_complementarity"),
      assessment: assessKoGuide(model, guide), outcomes: koScorer ? koScorer(guide) : null });
  }
  rows.sort(makeCompareRows(Boolean(common))); rows.forEach((row, index) => { row.rank = index + 1; });
  return { rows, isoforms, common, candidatesScanned: seen.size, qualityRejected, coverageRejected, spliceBoundaryRejected };
}

/** Rank all eligible single guides, then examine combinations of a bounded, declared shortlist.
 * Common coding coverage is required across the usable CDS annotations supplied in this record.
 * Expression, domains, variants and genome-wide specificity are not inferred from absent data.
 */
export function selectFunctionalKoGuides(model, candidates, { enzyme = "spcas9", delivery = "rnp", koScorer = null, commonKoExons = null, gcPenaltyScale = 1, cutCoverage = null, sensitivity = true } = {}) {
  const { rows, isoforms, common, candidatesScanned, qualityRejected, coverageRejected, spliceBoundaryRejected } = rankKoSingles(model, candidates, { enzyme, delivery, koScorer, commonKoExons, gcPenaltyScale, cutCoverage });
  const metadata = { version: KO_SELECTION_VERSION, policy: `Spacer GC outside ${GC_POLICY.excludeBelow}–${GC_POLICY.excludeAbove}% is excluded and 35–40/60–70% (5 points) and 30–35/70–80% (10 points) are penalised in predicted LoF; cuts more than 10 bp inside every evaluated coding annotation; individual functional tier, isoform escape${common ? ", pan-isoform common exon" : ""}; supported repair outcomes after the GC penalty in 5-point bins; exon-skipping flag, splice margin and GC balance as tie-breaks.`,
    gcPolicy: GC_POLICY, gcPenaltyScale, commonKoExons: common ? [...common] : null, delivery, candidatesScanned, eligibleGuides: rows.length,
    qualityRejected, coverageRejected, spliceBoundaryRejected, isoformsEvaluated: isoforms.length,
    evidenceScope: "Usable coding annotations of the same gene in the supplied record; not proof of coverage of every expressed isoform. Coding coverage describes cut placement, not functional loss in every isoform.",
    unassessed: KO_UNASSESSED,
    validation: ["Sequence each edited site and the deletion junction separately.", "Use the supplied screening primers; check allele dropout and copy number when interpreting clones.", "Confirm loss of protein and the relevant biological function."],
    independentGuides: rows.slice(0, 2).map(publicRow), backups: rows.slice(2, 8).map(publicRow) };
  if (rows.length < 2) return { err: `No two knockout guides meet the sequence-quality (spacer GC ${GC_POLICY.excludeBelow}–${GC_POLICY.excludeAbove}%) and shared coding-coverage requirements (${rows.length} eligible). Criteria were not relaxed.`, selection: metadata };
  // Preserve the best two, then spread the remaining shortlist across cut positions.
  // Dense PAM enzymes must not fill the entire pair search with overlapping sites.
  const shortlist = rows.slice(0, 2);
  for (const row of rows.slice(2)) {
    if (shortlist.length >= PAIR_SHORTLIST) break;
    if (shortlist.every(other => Math.abs(other.guide.cut - row.guide.cut) >= 20)) shortlist.push(row);
  }
  for (const row of rows) {
    if (shortlist.length >= PAIR_SHORTLIST) break;
    if (!shortlist.includes(row)) shortlist.push(row);
  }
  const pairs = [];
  for (let i = 0; i < shortlist.length; i += 1) for (let j = i + 1; j < shortlist.length; j += 1) {
    const a = shortlist[i]; const b = shortlist[j]; const spacing = Math.abs(a.guide.cut - b.guide.cut);
    if (spacing < 10 || spacing > 140) continue;
    const assessment = assessKoPair(model, a.guide, b.guide);
    pairs.push({ a, b, spacing, assessment });
  }
  pairs.sort((a, b) => KO_TIER_RANK[a.assessment.tier] - KO_TIER_RANK[b.assessment.tier]
    || KO_TIER_RANK[a.assessment.between.tier] - KO_TIER_RANK[b.assessment.between.tier]
    || Number(a.assessment.between.class === "inframe") - Number(b.assessment.between.class === "inframe")
    || (common ? Number(!(a.a.inCommonExon && a.b.inCommonExon)) - Number(!(b.a.inCommonExon && b.b.inCommonExon)) : 0)
    || Math.min(coverageStep(b.a), coverageStep(b.b)) - Math.min(coverageStep(a.a), coverageStep(a.b))
    || a.assessment.isoformGapScore - b.assessment.isoformGapScore
    || Math.min(effectiveLofBin(b.a), effectiveLofBin(b.b)) - Math.min(effectiveLofBin(a.a), effectiveLofBin(a.b))
    || effectiveLofBin(b.a) + effectiveLofBin(b.b) - effectiveLofBin(a.a) - effectiveLofBin(a.b)
    || Number(b.spacing >= 40) - Number(a.spacing >= 40)
    || Math.max(a.a.rank, a.b.rank) - Math.max(b.a.rank, b.b.rank)
    || a.a.rank + a.b.rank - b.a.rank - b.b.rank
    || Math.abs(a.spacing - 90) - Math.abs(b.spacing - 90));
  const best = pairs[0];
  const independentPair = assessKoPair(model, rows[0].guide, rows[1].guide);
  const selection = { ...metadata, independentPair, pairCandidatesEvaluated: pairs.length, pairShortlistSize: shortlist.length,
    pairSearch: `All combinations of ${shortlist.length} ranked guides (top two retained; remaining positions favor cuts at least 20 bp apart) with cuts 10–140 bp apart (40–140 preferred among equivalent functional assessments). This is a shortlist search, not a global optimality claim.`,
    recommendedPair: best ? { guides: [publicRow(best.a), publicRow(best.b)], tier: best.assessment.tier,
      assessment: best.assessment, sameAsTopIndividuals: best.a.rank === 1 && best.b.rank === 2 } : null };
  if (!best) return { err: `No coordinated pair within the ranked shortlist meets the 10–140 bp spacing requirement. Best individual guides: ${selection.independentGuides.map(g => `${g.spacer} (GC ${g.gc.toFixed(1)}%)`).join("; ")}. Criteria were not relaxed.`, selection };
  const guides = [best.a.guide, best.b.guide].sort((a, b) => a.cut - b.cut);
  // The size of the GC penalty is not calibrated. Say whether the pair survives it being doubled, and what would be chosen if it did not.
  if (sensitivity && koScorer) {
    const doubled = selectFunctionalKoGuides(model, candidates, { enzyme, delivery, koScorer, commonKoExons, gcPenaltyScale: gcPenaltyScale * 2, cutCoverage, sensitivity: false });
    const same = doubled.pair && doubled.pair.guides.map(keyOf).join("|") === guides.map(keyOf).join("|");
    selection.gcSensitivity = same ? { stableWhenPenaltyDoubled: true, note: "The same pair is chosen when the GC penalty is doubled." }
      : { stableWhenPenaltyDoubled: false, alternativeWhenDoubled: doubled.pair ? { guides: [...doubled.selection.recommendedPair.guides].sort((a, b) => a.cut - b.cut), tier: doubled.selection.recommendedPair.tier } : null,
          note: "The pair depends on how much a low or high spacer GC costs in activity, which is not calibrated; the alternative that a doubled penalty selects is listed." };
  }
  return { pair: { guides, spacing: best.spacing }, selection };
}

const KO_PICKER_ROWS = 60;

/**
 * The ranked single guides as the Design screen lists them for choosing a pair: the selector's own order (rankKoSingles), the predicted repair
 * outcome of each guide, and where it cuts. At most KO_PICKER_ROWS rows, plus any guide named in `include` (the chosen pair).
 */
export function buildKoPicker(model, candidates, { enzyme = "spcas9", delivery = "rnp", koScorer = null, commonKoExons = null, gcPenaltyScale = 1, cutCoverage = null, include = [] } = {}) {
  const ranked = rankKoSingles(model, candidates, { enzyme, delivery, koScorer, commonKoExons, gcPenaltyScale, cutCoverage });
  const keep = new Set(include.map(spacer => String(spacer).toUpperCase()));
  const chosen = ranked.rows.filter((row, index) => index < KO_PICKER_ROWS || keep.has(sequenceOf(row.guide)));
  const rows = chosen.map(row => {
    const o = row.outcomes;
    return { rank: row.rank, spacer: sequenceOf(row.guide), strand: row.guide.str || row.guide.strand, pam: row.guide.pam, cut: row.guide.cut,
      exon: row.exonIndex, offsetInExon: row.guide.cut - model.cdsSegments[row.exonIndex - 1][0],
      gc: row.gc, gcPenaltyPts: row.gcPenaltyPts, tier: row.assessment.tier,
      lofPct: o?.lofPct ?? null, effectiveLofPct: o ? Math.round(effectiveLof(row) * 10) / 10 : null, ...(row.cutCoverage === undefined ? {} : { isoformCoveragePct: Math.round(row.cutCoverage * 1000) / 10 }), frameshiftPct: o?.frameshiftPct ?? null,
      plus1Pct: o?.plus1Pct ?? null, inframePct: o?.inframePct ?? null, biallelicPct: o?.biallelicPct ?? null, otherIsoformNotDisruptedPct: o?.gapPct ?? null,
      spliceMargin: row.spliceMargin, exonSkippingInFrame: row.exonSkippingInFrame, selfComplementarityFlag: row.selfComplementarityFlag,
      ...(row.inCommonExon === undefined ? {} : { inCommonExon: row.inCommonExon }) };
  });
  return { version: KO_SELECTION_VERSION, outcomeModel: koScorer ? "Lindel (Chen et al. 2019) with the Assured QC NMD and truncation rules" : null,
    isoformsEvaluated: ranked.isoforms.length, eligible: ranked.rows.length, listed: rows.length, scanned: ranked.candidatesScanned,
    rejected: { quality: ranked.qualityRejected, coverage: ranked.coverageRejected, spliceBoundary: ranked.spliceBoundaryRejected }, rows };
}

/** One or two sentences for the report when the pair was chosen by hand, naming what the selector recommended for comparison. Empty when the selector's pair was used. */
export function describeKoPairChoice(choice) {
  if (!choice || choice.source !== "user") return [];
  const pct = value => (Number.isFinite(value) ? `${value}%` : "not predicted");
  const lines = ["Guide pair chosen by the user from the ranked list. It is assessed like any pair below but is not labelled as the selector's optimum."];
  if (choice.recommended) lines.push(`Selector's recommendation: ${choice.recommended.pair.join(" + ")} (weaker guide predicted LoF ${pct(choice.recommended.minLofPct)}). This pair: ${choice.pair.join(" + ")} (${pct(choice.minLofPct)}).`);
  else lines.push("The selector found no pair to compare this one with.");
  return lines;
}

export function describeKoSelection(selection) {
  if (!selection) return [];
  const list = rows => rows.map(g => `#${g.rank} ${g.spacer} (${g.strand}, GC ${g.gc.toFixed(1)}%${g.gcPenaltyPts ? ` (penalty ${g.gcPenaltyPts} points)` : ""}, ${g.tier}, coding coverage ${g.coveredIsoforms}/${g.isoformsEvaluated}, boundary margin ${g.spliceMargin} bp${g.exonSkippingInFrame ? ", in-frame exon-skipping flag" : ""}${g.selfComplementarityFlag ? ", self-complementarity flag" : ""}${g.isoformGaps.length ? `, escape flags in ${g.isoformGaps.map(gap => gap.id).join("/")}` : ""})`).join("; ");
  return [
    `Selection ${selection.version}: ${selection.policy}`,
    `${selection.eligibleGuides} eligible of ${selection.candidatesScanned} scanned; ${selection.isoformsEvaluated} coding annotations evaluated. ${selection.evidenceScope}`,
    `Best individual guides: ${list(selection.independentGuides)}.`,
    ...(selection.independentPair ? [`Top individuals together: ${selection.independentPair.tier}; nominal deletion ${selection.independentPair.between.sizeBp} bp, ${selection.independentPair.between.class}.`] : []),
    ...(selection.recommendedPair ? [`Recommended coordinated pair: ${list(selection.recommendedPair.guides)}. ${selection.recommendedPair.sameAsTopIndividuals ? "Same as the two best individual guides." : "Different from the two best individual guides; guides in this design are the coordinated pair."}`] : []),
    ...(selection.pairSearch ? [selection.pairSearch] : []),
    `Backup individual guides: ${list(selection.backups) || "None qualify"}.`,
    ...(selection.gcSensitivity ? [selection.gcSensitivity.stableWhenPenaltyDoubled ? `GC penalty sensitivity: ${selection.gcSensitivity.note}` : `GC penalty sensitivity: ${selection.gcSensitivity.note}${selection.gcSensitivity.alternativeWhenDoubled ? ` Alternative: ${list(selection.gcSensitivity.alternativeWhenDoubled.guides)}.` : ""}`] : []),
    `Self-complementarity flags use a sequence screen; they do not represent RNA folding energies.`,
    `Exon skipping: an in-frame coding-exon length is a rescue flag, not a prediction that skipping will occur. Splicing changes are not simulated.`,
    `Not assessed: ${selection.unassessed.join("; ")}.`,
    `Validation: ${selection.validation.join(" ")}`,
  ];
}
