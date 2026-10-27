/**
 * Point-mutation candidate set: several matched guide + donor pairs for one substitution, with the
 * core design checks (Stage 1) verified against the reference rather than read back from the
 * engine's own objects.
 *
 * What this module decides and what it does not:
 * - It enumerates every SpCas9 guide near the edit, builds up to `donorVersionsPerGuide` donors for
 *   each (version 0 is the donor `runDesign` builds; later versions avoid the earlier versions'
 *   blocker positions), and applies five pass/fail gates.
 * - It orders the passing rows by tier and keeps up to six. Genome-wide specificity is NOT assessed
 *   (no genome is available to the engine) and is carried as `not-assessed` on every candidate.
 * - It says nothing about regulatory effects. That evidence is added separately
 *   (src/services/candidateRanking.js) and only ever reorders candidates inside this set.
 *
 * Candidates are SpCas9 only. Nothing here changes the output of runDesign.
 */
import {
  toAA, parseGB, runDesign, mkODN, findPointMutationBlockingSet,
  assessGuideAgainstPointMutationDonor, CFD_PROTECTION_THRESHOLDS,
} from "./designEngine.js";
import { getCodonAtAa, findSpCas9Guides, normalizeGenBankToTranscriptModel } from "./transcriptModel.js";
import { reverseComplementDna } from "./enzymeGuides.js";
import { calculateCfd } from "./cfd.js";
import { GC_POLICY } from "./koSelection.js";

export const PM_CANDIDATE_SCHEMA = "assured-pm-candidates/1";

export const PM_CANDIDATE_RULE = Object.freeze({
  version: 1,
  searchWindowBp: 30,
  donorVersionsPerGuide: 2,
  minCandidates: 3,
  maxCandidates: 6,
  maxCandidatesPerGuide: 2,
  thresholds: Object.freeze({
    maxCfd: CFD_PROTECTION_THRESHOLDS.strong,
    maxCutDistance: 20,
    minArm: 30, // a convention for ssODN arms either side of the edit, not a measured threshold
    preferredCutWindow: 10,
    gcMin: GC_POLICY.excludeBelow, // the exclusion limits the knockout selector already uses
    gcMax: GC_POLICY.excludeAbove,
  }),
  gates: Object.freeze({
    G1: "edited CDS differs from the reference only by the requested substitution",
    G2: "repaired-allele CFD is at or below the strong-protection threshold",
    G3: "cut within the maximum distance of the edit",
    G4: "donor arms at least the minimum on each side of the edit and every substitution inside the donor",
    G5: "spacer occurs once in the reference window and has an NGG PAM",
    G6: "spacer GC within the exclusion limits used by the knockout selector",
  }),
  tierKey: "cut window (<= preferred first), protection robustness (PAM disrupted or >= 2 spacer mismatches before a single mismatch with intact PAM), fewer blockers",
  notAssessed: "genome-wide specificity",
});

const BASES = "ACGT";

function pickMutantCodon(codonInfo, mutAA) {
  // Same choice runDesign makes: the target-amino-acid codon needing the fewest base changes.
  let best = null; let bestChanges = [];
  for (const b1 of BASES) for (const b2 of BASES) for (const b3 of BASES) {
    const codon = `${b1}${b2}${b3}`;
    if (toAA(codon) !== mutAA) continue;
    const changes = [];
    for (let i = 0; i < 3; i += 1) if (codonInfo.cod[i] !== codon[i]) changes.push({ p: codonInfo.genomicPositions[i], w: codonInfo.cod[i], m: codon[i] });
    if (!best || changes.length < bestChanges.length) { best = codon; bestChanges = changes; }
  }
  return best ? { codon: best, changes: bestChanges } : null;
}

function translate(seq) {
  let out = "";
  for (let i = 0; i + 3 <= seq.length; i += 3) out += toAA(seq.slice(i, i + 3));
  return out;
}

function codingSequence(model, genomic) {
  return (model.cdsSegments || []).map(([start, end]) => genomic.slice(start, end)).join("");
}

function indexesOf(haystack, needle) {
  const out = []; let from = 0;
  for (;;) { const i = haystack.indexOf(needle, from); if (i < 0) return out; out.push(i); from = i + 1; }
}

function guideSite(genomic, guide) {
  // Protospacer + PAM in guide orientation, located by sequence search rather than by the engine's coordinates.
  const forward = guide.sp + guide.pam;
  const probe = guide.str === "+" ? forward : reverseComplementDna(forward);
  const hits = indexesOf(genomic, probe);
  if (!hits.length) return null;
  const i0 = hits[0];
  const cut = guide.str === "+" ? i0 + 17 : i0 + 6;
  const read = (seq) => (guide.str === "+" ? seq.slice(i0, i0 + 23) : reverseComplementDna(seq.slice(i0, i0 + 23)));
  return { i0, cut, occurrences: hits.length, read };
}

function cfdOf(spacer, site) {
  if (!site || site.length !== 23 || !/^[ACGT]+$/.test(site)) return null;
  const scored = calculateCfd(spacer, site.slice(0, 20), site.slice(20));
  return scored && Number.isFinite(scored.score) ? scored.score : null;
}

function mismatchPositions(spacer, target) {
  const out = [];
  for (let i = 0; i < 20; i += 1) if (spacer[i] !== target[i]) out.push(i + 1);
  return out;
}

function gcPercent(spacer) { return Math.round((100 * [...spacer].filter((b) => b === "G" || b === "C").length) / spacer.length); }

/** Verify one guide + donor row against the reference and apply the gates. */
export function evaluateRow(model, edit, guide, donor, blockers, engineProtection, rule = PM_CANDIDATE_RULE) {
  const genomic = model.genomicSequence.toUpperCase();
  const t = rule.thresholds;
  const start = donor.donorStart; const end = donor.donorEnd;
  const allele = donor.genomicDonor.toUpperCase();
  const lengthOk = allele.length === end - start;
  const repaired = lengthOk ? genomic.slice(0, start) + allele + genomic.slice(end) : genomic;
  const substitutions = [];
  if (lengthOk) for (let i = 0; i < allele.length; i += 1) if (genomic[start + i] !== allele[i]) substitutions.push({ index: start + i, ref: genomic[start + i], alt: allele[i] });
  const refProtein = translate(codingSequence(model, genomic));
  const newProtein = translate(codingSequence(model, repaired));
  const aaChanges = [];
  for (let i = 0; i < Math.max(refProtein.length, newProtein.length); i += 1) if (refProtein[i] !== newProtein[i]) aaChanges.push({ aa: i + 1, from: refProtein[i], to: newProtein[i] });
  const g1 = lengthOk && aaChanges.length === 1 && aaChanges[0].aa === edit.aaNumber && aaChanges[0].to === edit.mutAA && aaChanges[0].from === edit.wtAA;

  const site = guideSite(genomic, guide);
  const targetRepaired = site ? site.read(repaired) : null;
  let editOnlyAllele = genomic;
  edit.positions.forEach((p, k) => { editOnlyAllele = editOnlyAllele.slice(0, p) + edit.bases[k] + editOnlyAllele.slice(p + 1); });
  const targetEditOnly = site ? site.read(editOnlyAllele) : null;
  const repairedCfd = cfdOf(guide.sp, targetRepaired);
  const editOnlyCfd = cfdOf(guide.sp, targetEditOnly);
  const g2 = Number.isFinite(repairedCfd) && repairedCfd <= t.maxCfd;
  const nearest = site ? Math.min(...edit.positions.map((p) => Math.abs(site.cut - p))) : null;
  const g3 = site !== null && nearest <= t.maxCutDistance;
  const armFive = Math.min(...edit.positions) - start; const armThree = end - Math.max(...edit.positions) - 1;
  const g4 = lengthOk && armFive >= t.minArm && armThree >= t.minArm && substitutions.length > 0 && substitutions.every((s) => s.index >= start && s.index < end);
  const g5 = site !== null && site.occurrences === 1 && /^[ACGT]GG$/.test(guide.pam);

  const spacerMismatches = targetRepaired ? mismatchPositions(guide.sp, targetRepaired.slice(0, 20)) : [];
  const pamAfter = targetRepaired ? targetRepaired.slice(20) : null;
  const pamDisrupted = pamAfter !== null && !/^[ACGT]GG$/.test(pamAfter);
  const flags = {
    gcOutside40to60: (() => { const gc = gcPercent(guide.sp); return gc < 40 || gc > 60; })(),
    singleMismatchIntactPam: !pamDisrupted && spacerMismatches.length <= 1,
    pamDisrupted,
    cfdExactlyZero: repairedCfd === 0,
    engineCfdDisagrees: Number.isFinite(engineProtection?.cfd) && Number.isFinite(repairedCfd) && Math.abs(engineProtection.cfd - repairedCfd) > 1e-6,
  };
  const gc = gcPercent(guide.sp);
  const g6 = gc >= t.gcMin && gc <= t.gcMax;
  const gates = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5, G6: g6 };
  const windowTier = nearest !== null && nearest <= t.preferredCutWindow ? 0 : 1;
  const robust = pamDisrupted || spacerMismatches.length >= 2 ? 0 : 1;
  return {
    gates, passes: Object.values(gates).every(Boolean), flags,
    substitutions, aaChanges,
    verified: {
      cutIndex: site?.cut ?? null, cutAgreesWithEngine: site ? site.cut === guide.cut : false, cutToEditBp: nearest,
      arms: { five: armFive, three: armThree }, spacerOccurrences: site?.occurrences ?? 0,
      spacerMismatches, pamAfterRepair: pamAfter, repairedAlleleCfd: repairedCfd, editOnlyCfd,
    },
    stage1Key: [windowTier, robust, blockers.length],
    gc,
    changedBases: substitutions.map((s) => `${s.index + 1}${s.ref}>${s.alt}`).join(";"),
  };
}

function signatureOf(substitutions) { return substitutions.map((s) => `${s.index + 1}${s.ref}>${s.alt}`).join(";"); }
function compareKeys(a, b) { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

/** Build the candidate set for one substitution on a transcript model. */
export function buildPmCandidateSet(model, mutation, options = {}) {
  const rule = { ...PM_CANDIDATE_RULE, ...(options.rule || {}) };
  const match = typeof mutation === "string" ? /^\s*([A-Za-z])(\d+)([A-Za-z])\s*$/.exec(mutation) : null;
  const wtAA = (match ? match[1] : mutation?.wtAA || "").toUpperCase();
  const aaNumber = match ? Number(match[2]) : Number(mutation?.aaNumber);
  const mutAA = (match ? match[3] : mutation?.mutAA || "").toUpperCase();
  if (!wtAA || !Number.isInteger(aaNumber) || !mutAA) return { err: "Enter a protein change such as R176C." };
  const codonInfo = getCodonAtAa(model, aaNumber, toAA);
  if (!codonInfo) return { err: `Cannot map amino acid ${aaNumber} to the genomic sequence.` };
  if (codonInfo.aa !== wtAA) return { err: `Expected ${wtAA} at position ${aaNumber} but found ${codonInfo.aa} (${codonInfo.cod}).` };
  const chosen = pickMutantCodon(codonInfo, mutAA);
  if (!chosen) return { err: `No codon encodes ${mutAA}.` };
  const edit = {
    aaNumber, wtAA, mutAA, wtCodon: codonInfo.cod, mutCodon: chosen.codon,
    positions: chosen.changes.map((c) => c.p), bases: chosen.changes.map((c) => c.m), codonStart: codonInfo.g,
  };
  const maxChanges = Number.isFinite(options.maxBlockingChanges) ? options.maxBlockingChanges : 3;
  const guides = findSpCas9Guides(model, reverseComplementDna, codonInfo.g, rule.searchWindowBp)
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.cut - b.cut);
  const rows = [];
  for (const guide of guides) {
    const blocked = new Set(codonInfo.genomicPositions);
    for (let version = 0; version < rule.donorVersionsPerGuide; version += 1) {
      const set = findPointMutationBlockingSet(model, guide, blocked, { maxChanges, allowNonCodingBlockers: options.allowNonCodingBlockers });
      if (!set.length) break;
      const donor = mkODN(model, guide, edit.positions, edit.bases, set, { aaNumber, intendedAa: mutAA });
      if (donor?.proteinValidation?.valid) {
        const engineProtection = assessGuideAgainstPointMutationDonor(guide, donor);
        const ev = evaluateRow(model, edit, guide, donor, set, engineProtection, rule);
        rows.push({
          key: `${guide.str}${guide.ps}.v${version}`, guideKey: `${guide.str}${guide.ps}`, version,
          guide: { sp: guide.sp, pam: guide.pam, str: guide.str, gc: ev.gc, ps: guide.ps, cut: guide.cut, d: guide.d },
          blockers: set.map((m) => ({ gp: m.gp, nb: m.nb, lb: m.lb, oc: m.oc, nc: m.nc, pur: m.pur })),
          donor: { ssodn: donor.od, genomicDonor: donor.genomicDonor, start: donor.donorStart, end: donor.donorEnd, orientation: guide.str === "-" ? "plus" : "reverse-complement" },
          engine: { tier: engineProtection.tier, cfd: engineProtection.cfd ?? null },
          ...ev,
        });
      }
      set.forEach((m) => blocked.add(m.gp));
    }
  }
  const passing = rows.filter((r) => r.passes)
    .sort((a, b) => compareKeys(a.stage1Key, b.stage1Key) || Math.abs(a.verified.cutToEditBp) - Math.abs(b.verified.cutToEditBp) || a.key.localeCompare(b.key));
  const perGuide = new Map(); const kept = [];
  for (const row of passing) {
    if (kept.length >= rule.maxCandidates) break;
    if ((perGuide.get(row.guideKey) || 0) >= rule.maxCandidatesPerGuide) continue;
    perGuide.set(row.guideKey, (perGuide.get(row.guideKey) || 0) + 1); kept.push(row);
  }
  const tiers = [...new Set(kept.map((r) => r.stage1Key.join(",")))];
  const candidates = kept.map((row, index) => ({
    id: row.key, label: `Candidate ${index + 1}`,
    guide: row.guide, donorVersion: row.version, blockers: row.blockers, donor: row.donor,
    substitutions: row.substitutions, alleleSignature: signatureOf(row.substitutions),
    protection: { engineTier: row.engine.tier, engineCfd: row.engine.cfd, ...row.verified },
    gates: row.gates, flags: row.flags,
    stage1: { key: row.stage1Key, tier: tiers.indexOf(row.stage1Key.join(",")) + 1 },
    specificity: { status: "not-assessed", note: "Genome-wide off-target search is required before ordering." },
  }));
  const excluded = rows.filter((r) => !r.passes).map((r) => ({
    id: r.key, guide: r.guide, donorVersion: r.version,
    failedGates: Object.entries(r.gates).filter(([, ok]) => !ok).map(([g]) => g),
    arms: r.verified.arms, repairedAlleleCfd: r.verified.repairedAlleleCfd, cutToEditBp: r.verified.cutToEditBp,
  }));
  const alleles = new Map();
  candidates.forEach((c) => alleles.set(c.alleleSignature, [...(alleles.get(c.alleleSignature) || []), c.id]));
  const notes = [];
  if (candidates.length < rule.minCandidates) notes.push(`Only ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} passed the gates; fewer than the ${rule.minCandidates} wanted.`);
  for (const [signature, ids] of alleles) if (ids.length > 1) notes.push(`Candidates ${ids.join(", ")} carry the same substitution set (${signature}); regulatory predictions cannot tell them apart.`);
  return {
    schema: PM_CANDIDATE_SCHEMA, rule: { ...rule, thresholds: { ...rule.thresholds } }, edit,
    counts: { guides: guides.length, rows: rows.length, passing: passing.length, candidates: candidates.length },
    candidates, excluded, alleles: [...alleles].map(([signature, ids]) => ({ signature, candidateIds: ids })), notes,
  };
}

/** Run the normal design and attach the candidate set. The design itself is exactly what runDesign returns. */
export function designWithCandidates(gbRaw, mutation, options = {}) {
  const result = runDesign("pm", gbRaw, mutation, "", options.homologyArmLength || 400, options);
  if (!result || result.err) return result;
  if (options.enzyme && options.enzyme !== "spcas9") return { ...result, pmCandidates: { err: "Candidate sets are available for SpCas9 designs only." } };
  const parsed = parseGB(gbRaw);
  const model = normalizeGenBankToTranscriptModel(parsed, { expectedGene: options.expectedGene });
  return { ...result, pmCandidates: buildPmCandidateSet(model, mutation, options) };
}
