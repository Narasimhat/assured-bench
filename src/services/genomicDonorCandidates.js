import { designGenomicSnp } from '../engine/design/genomicSnp.js';
import { normalizeGenomicDesign } from './genomicDesignResult.js';
import { assessGuideAgainstPointMutationDonor } from '../engine/design/designEngine.js';

export const genomicReference = project => project.genomicDesignInput?.genbankRaw || project.genbankRaw || '';

/** Preserve exact donor alleles while recomputing protection against every selected RNP. */
export function assembleGenomicPairs(entries, { joint = false } = {}) {
  if (!entries.length || entries.length > 2) throw new Error('Select one or two genomic SNP donors.');
  const first = entries[0].result;
  if (first.type !== 'genomic-snv') throw new Error('A genomic SNP design is required.');
  const candidates = entries.map(({ result, donorIndex = 0 }, i) => {
    if (result.type !== first.type || result.gb.genomicSequence !== first.gb.genomicSequence ||
      ['assembly', 'chromosome', 'referenceStart', 'orientation', 'position', 'ref', 'alt'].some(k => result.input[k] !== first.input[k])) throw new Error('Genomic donors must describe the same reference and intended SNP.');
    const candidate = result.candidates[donorIndex];
    if (!candidate?.nucleotideValidation?.valid) throw new Error('The genomic donor has not passed nucleotide validation.');
    return { ...candidate, name: `gRNA${i + 1}` };
  });
  if (new Set(candidates.map(c => c.sp)).size !== candidates.length) throw new Error('Choose different guide sequences.');
  for (const c of candidates) c.crossProtection = candidates.map(g => ({ guideName: g.name, ...assessGuideAgainstPointMutationDonor(g, c.donor) }));
  const safe = candidates.every(c => c.crossProtection.every(p => p.tier === 'strong'));
  if (joint && !safe) throw new Error('The rebuilt genomic donors do not strongly protect against both guides.');
  const changes = [...new Map(candidates.flatMap(c => c.blockingChanges).map(c => [`${c.gp}:${c.nb}`, c])).values()];
  const blockers = candidates.filter(c => c.protection.tier !== 'strong').map(c => `${c.name} lacks strong matched-guide protection.`);
  const warnings = [...new Set([...entries.flatMap(e => e.result.warnings || []).filter(w => !/^(?:\d+ blocking substitution|No blocking set was added|The requested edit already protects|No additional blocking|Permitted blocking|Delivered separately:|Co-delivery:|Alternative guides and donors)/.test(w)),
    'Genome-wide specificity, mature RNA and protein function remain unvalidated.',
    ...(!safe && candidates.length === 2 ? ['Cross-guide protection is incomplete; the second RNP can re-cut a repaired allele.'] : [])])];
  // Pair-specific recommendations and external splice checks belong to the exact previous alleles.
  const { blocking: oldBlocking, splice, recommendation, workflowRecommendation, ...base } = first;
  const normalized = normalizeGenomicDesign({ ...base, candidates, blockers, warnings, status: blockers.length ? 'BLOCKED' : 'REVIEW REQUIRED',
    ...(candidates.length === 2 ? { blocking: { mode: joint ? 'pair' : 'independent', coDelivery: joint, feasible: true,
      pair: candidates.map(c => c.name), separation: Math.abs(candidates[0].cut - candidates[1].cut), changes,
      minSeparation: joint ? 10 : 0, alternatives: [], otherPairs: [],
      cfdBefore: candidates.map(c => c.comparison?.variants?.[0]?.protection?.cfd ?? null), cfdAfter: candidates.map(c => c.protection.cfd ?? null),
      donors: candidates.map(c => ({ name: c.name, changes: c.blockingChanges })) } } : {}) });
  normalized.os = normalized.os.map((d, i) => ({ ...d, gi: i }));
  normalized.ss = candidates.flatMap((c, gi) => c.blockingChanges.map(m => ({ ...m, gi })));
  normalized.coDeliverySafe = safe;
  normalized.coDeliveryBlockingRequested = joint;
  if (candidates.length === 2) {
    const cuts = candidates.map(c => c.cut).sort((a, b) => a - b);
    normalized.dualCutDeletionRisk = { cutSites: cuts, spans: [cuts[1] - cuts[0]],
      note: `The two RNPs cut ${cuts[1] - cuts[0]} bp apart; screen for an intervening deletion as well as the intended SNP.` };
  }
  return normalized;
}

export async function generateGenomicCandidates(project, previous, identity) {
  const base = project.designResult;
  if (base.enzyme && base.enzyme.id !== 'spcas9') throw new Error('Automatic genomic SNP comparison currently supports SpCas9 only.');
  const sourceId = await identity(project);
  if (previous && previous.sourceId !== sourceId) throw new Error('Genomic SNP inputs changed; generate candidates again.');
  const raw = genomicReference(project);
  const policy = base.input.blockingPolicy;
  // Only existing native blocking policies are used; an exact-edit request stays exact.
  const pool = designGenomicSnp(raw, { ...base.input, blockingPolicy: ['pair', 'independent'].includes(policy) ? 'noncoding' : policy, guideSpacers: null });
  if (pool.err) throw new Error(pool.err);
  const candidates = previous ? [...previous.candidates] : [];
  const seen = new Set(candidates.map(c => `${c.result.gs[0].sp}:${c.result.os[0].od}`));
  const add = (result, donorIndex, baseline = false) => {
    const one = assembleGenomicPairs([{ result, donorIndex }]);
    const c = one.candidates[0];
    const key = `${c.sp}:${c.donor.od}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ id: `pair-${candidates.length + 1}`, round: previous ? 2 : 1, baseline,
      result: one, eligible: c.nucleotideValidation.valid && c.protection.tier === 'strong',
      blockers: c.blockingChanges.length, protection: c.protection.tier, reasons: [...one.procurement.blockers, ...one.procurement.warnings] });
  };
  if (!previous) {
    const retained = project.donorCandidatePanel?.sourceId === sourceId ? project.donorCandidatePanel.candidates.filter(c => c.baseline) : [];
    if (retained.length === 2) retained.forEach(c => add(c.result, 0, true));
    else if (base.candidates.length === 2) base.candidates.forEach((_, i) => add(base, i, true));
    const normalized = normalizeGenomicDesign(pool);
    const ordered = pool.candidates.map((c, i) => ({ c, i })).sort((a,b) => Number(b.c.protection.tier === 'strong') - Number(a.c.protection.tier === 'strong') || Math.abs(a.c.d) - Math.abs(b.c.d));
    for (const { c, i } of ordered) {
      if (candidates.length >= 6) break;
      if (candidates.some(x => x.result.gs[0].sp === c.sp)) continue;
      add(normalized, i);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } else {
    // Native PAM/seed donor variants, preserving their validated nucleotide and codon checks.
    for (const parent of previous.candidates) {
      const c = pool.candidates.find(c => c.sp === parent.result.gs[0].sp);
      for (const variant of c?.comparison?.variants || []) {
        if (candidates.length >= 12) break;
        const alternative = { ...c, donor: variant.donor, protection: variant.protection, blockingChanges: variant.changes,
          spliceAssessment: variant.splice, nucleotideValidation: { valid: true, differences: 1 + variant.changes.length, additionalChanges: variant.changes.length } };
        add(normalizeGenomicDesign({ ...pool, candidates: [alternative] }), 0);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return { sourceId, candidates, attempts: [], rounds: previous ? 2 : 1, createdAt: new Date().toISOString() };
}

export function buildGenomicTwoPairResult(project, selected, protectBoth) {
  const entries = selected.map(c => ({ result: c.result }));
  const independent = assembleGenomicPairs(entries);
  if (!protectBoth) return independent;
  if (independent.coDeliverySafe) return assembleGenomicPairs(entries, { joint: true });
  if (project.designResult.input.blockingPolicy === 'none') throw new Error('Exact-edit-only policy forbids adding blocking substitutions. Enable blocking changes in the genomic SNP settings first.');
  const spacers = selected.map(c => c.result.gs[0].sp);
  const rebuilt = designGenomicSnp(genomicReference(project), { ...project.designResult.input, blockingPolicy: 'pair', guideSpacers: spacers });
  if (rebuilt.err) throw new Error(rebuilt.err);
  if (!rebuilt.blocking?.feasible || rebuilt.candidates.length !== 2 || !spacers.every(sp => rebuilt.candidates.some(c => c.sp === sp))) throw new Error('No permitted shared blocking set was found for these genomic guides.');
  const normalized = normalizeGenomicDesign(rebuilt);
  return assembleGenomicPairs(spacers.map(sp => ({ result: normalized, donorIndex: normalized.candidates.findIndex(c => c.sp === sp) })), { joint: true });
}
