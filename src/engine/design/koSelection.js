// Sequence-supported knockout selection. Scores are evidence components, not probabilities
// of experimental success. Missing external evidence never counts as a passed check.
import { assessKoGuide, assessKoPair, codingModels, KO_TIER_RANK } from "./koOutcomes.js";
import { assessEnzymeGuide } from "./enzymeGuides.js";
import { getEnzyme } from "./enzymeConfig.js";

export const KO_SELECTION_VERSION = "2.0.0";
const PAIR_SHORTLIST = 32;
const sequenceOf = guide => String(guide.sp || guide.spacer || "").toUpperCase();
const keyOf = guide => `${guide.str || guide.strand}:${guide.cut}:${sequenceOf(guide)}`;
export function assessKoEligibility(guide, { enzyme = "spcas9", delivery = "rnp" } = {}) {
  const spacer = sequenceOf(guide);
  const gc = spacer.length ? 100 * [...spacer].filter(base => /[GC]/.test(base)).length / spacer.length : NaN;
  const qc = assessEnzymeGuide({ ...guide, spacer, gc }, getEnzyme(enzyme), {
    delivery, filters: { gc_min: 40, gc_max: 60, self_complement_length: 0 },
  });
  if (!/^[ACGT]+$/.test(spacer)) qc.reasons.push("invalid_spacer");
  return { ...qc, passed: qc.reasons.length === 0, gc };
}

const inside = (model, cut) => model.cdsSegments.find(([start, end]) => start < cut && cut < end);
const compareRows = (a, b) => b.coveredIsoforms - a.coveredIsoforms
  || KO_TIER_RANK[a.assessment.tier] - KO_TIER_RANK[b.assessment.tier]
  || a.assessment.isoforms.gaps.reduce((n, g) => n + g.nonLofPct, 0) - b.assessment.isoforms.gaps.reduce((n, g) => n + g.nonLofPct, 0)
  || (Math.floor((b.outcomes?.lofPct ?? 0) / 5) - Math.floor((a.outcomes?.lofPct ?? 0) / 5))
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
    outcomes: row.outcomes, reasons: row.assessment.reasons,
    qualification: "Frameshift-panel tier is conditional on a frameshift; it is not cutting efficiency or knockout probability." };
}

/** Rank all eligible single guides, then examine combinations of a bounded, declared shortlist.
 * Common coding coverage is required across the usable CDS annotations supplied in this record.
 * Expression, domains, variants and genome-wide specificity are not inferred from absent data.
 */
export function selectFunctionalKoGuides(model, candidates, { enzyme = "spcas9", delivery = "rnp", koScorer = null } = {}) {
  const isoforms = codingModels(model);
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
    rows.push({ guide, gc: quality.gc, coveredIsoforms, isoformsEvaluated: isoforms.length,
      spliceMargin, exonSkippingInFrame: segments.some(([a, b]) => (b - a) % 3 === 0),
      selfComplementarityFlag: assessEnzymeGuide({ ...guide, spacer: sequenceOf(guide), gc: quality.gc }, getEnzyme(enzyme), { delivery }).reasons.includes("self_complementarity"),
      assessment: assessKoGuide(model, guide), outcomes: koScorer ? koScorer(guide) : null });
  }
  rows.sort(compareRows); rows.forEach((row, index) => { row.rank = index + 1; });
  const metadata = { version: KO_SELECTION_VERSION, policy: "Strict 40–60% spacer GC; cuts more than 10 bp inside every evaluated coding annotation; individual functional tier and isoform escape; supported repair outcomes in 5-point bins; exon-skipping flag, splice margin and GC balance as tie-breaks.",
    gcRange: [40, 60], delivery, candidatesScanned: seen.size, eligibleGuides: rows.length,
    qualityRejected, coverageRejected, spliceBoundaryRejected, isoformsEvaluated: isoforms.length,
    evidenceScope: "Usable coding annotations of the same gene in the supplied record; not proof of coverage of every expressed isoform. Coding coverage describes cut placement, not functional loss in every isoform.",
    unassessed: ["Cell-specific isoform expression", "Essential-domain disruption", "Sample variants and copy number", "Genome-wide off-target specificity", "Calibrated cutting efficiency", "Thermodynamic RNA folding", "Neighboring regulatory effects and rearrangement risk"],
    validation: ["Sequence each edited site and the deletion junction separately.", "Use the supplied screening primers; check allele dropout and copy number when interpreting clones.", "Confirm loss of protein and the relevant biological function."],
    independentGuides: rows.slice(0, 2).map(publicRow), backups: rows.slice(2, 8).map(publicRow) };
  if (rows.length < 2) return { err: `No two knockout guides meet strict 40–60% GC, sequence-quality and shared coding-coverage requirements (${rows.length} eligible). Criteria were not relaxed.`, selection: metadata };
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
    || a.assessment.isoformGapScore - b.assessment.isoformGapScore
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
  return { pair: { guides, spacing: best.spacing }, selection };
}

export function describeKoSelection(selection) {
  if (!selection) return [];
  const list = rows => rows.map(g => `#${g.rank} ${g.spacer} (${g.strand}, GC ${g.gc.toFixed(1)}%, ${g.tier}, coding coverage ${g.coveredIsoforms}/${g.isoformsEvaluated}, boundary margin ${g.spliceMargin} bp${g.exonSkippingInFrame ? ", in-frame exon-skipping flag" : ""}${g.selfComplementarityFlag ? ", self-complementarity flag" : ""}${g.isoformGaps.length ? `, escape flags in ${g.isoformGaps.map(gap => gap.id).join("/")}` : ""})`).join("; ");
  return [
    `Selection ${selection.version}: ${selection.policy}`,
    `${selection.eligibleGuides} eligible of ${selection.candidatesScanned} scanned; ${selection.isoformsEvaluated} coding annotations evaluated. ${selection.evidenceScope}`,
    `Best individual guides: ${list(selection.independentGuides)}.`,
    ...(selection.independentPair ? [`Top individuals together: ${selection.independentPair.tier}; nominal deletion ${selection.independentPair.between.sizeBp} bp, ${selection.independentPair.between.class}.`] : []),
    ...(selection.recommendedPair ? [`Recommended coordinated pair: ${list(selection.recommendedPair.guides)}. ${selection.recommendedPair.sameAsTopIndividuals ? "Same as the two best individual guides." : "Different from the two best individual guides; guides in this design are the coordinated pair."}`] : []),
    ...(selection.pairSearch ? [selection.pairSearch] : []),
    `Backup individual guides: ${list(selection.backups) || "None qualify"}.`,
    `Self-complementarity flags use a sequence screen; they do not represent RNA folding energies.`,
    `Exon skipping: an in-frame coding-exon length is a rescue flag, not a prediction that skipping will occur. Splicing changes are not simulated.`,
    `Not assessed: ${selection.unassessed.join("; ")}.`,
    `Validation: ${selection.validation.join(" ")}`,
  ];
}
