import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessKoEligibility, selectFunctionalKoGuides, describeKoSelection } from '../src/engine/design/koSelection.js';
import { runDesign, parseGB } from '../src/engine/design/designEngine.js';
import { normalizeGenBankToTranscriptModel } from '../src/engine/design/transcriptModel.js';
import { codingModels } from '../src/engine/design/koOutcomes.js';
import { buildDesignSummary } from '../src/engine/design/reportHtml.js';
const text = fs.readFileSync(new URL('./fixtures/dipk2a-region.gb', import.meta.url), 'utf8');
const model = () => normalizeGenBankToTranscriptModel(parseGB(text), {});
const guide = (sp, cut = 14450) => ({ sp, cut, str: '+', pam: 'AGG' });

test('GC limits use exact spacer fractions, including variable-length Cas12 guides', () => {
  for (const sp of ['GCGCGCGCATATATATATAT', 'GCGCGCGCGCGCATATATAT']) assert.equal(assessKoEligibility(guide(sp)).passed, true);
  assert.equal(assessKoEligibility(guide('GCGCGCATATATATATATAT')).passed, false);
  assert.equal(assessKoEligibility(guide('GCGCGCGCGCGCGCATATAT')).passed, false);
  assert.equal(assessKoEligibility(guide('GCGCGCGCG' + 'AT'.repeat(7)), { enzyme: 'mad7' }).passed, false);
});
test('Pol III terminator restriction depends on delivery and homopolymers are rejected', () => {
  const g = guide('GCGCGCGCTTTTATATATAT');
  assert.equal(assessKoEligibility(g, { delivery: 'rnp' }).passed, true);
  assert.ok(assessKoEligibility(g, { delivery: 'poliii' }).reasons.includes('poliii_terminator'));
  assert.ok(assessKoEligibility(guide('GGGGGCGCATATATATATAT')).reasons.includes('homopolymer'));
});
test('no silent relaxation when fewer than two qualifying guides exist', () => {
  const r = selectFunctionalKoGuides(model(), [guide('AT'.repeat(10)), guide('GC'.repeat(10))]);
  assert.match(r.err, /not relaxed/); assert.equal(r.selection.eligibleGuides, 0);
});
test('shared coverage and splice-boundary eligibility apply to every supplied coding annotation', () => {
  const m = model(); const start = m.cdsSegments[0][0];
  const r = selectFunctionalKoGuides(m, [guide('GCGCGCGCATATATATATAT', 1), guide('GCGCGCGCATATATATATAT', start + 1)]);
  assert.ok(r.err); assert.ok(r.selection.coverageRejected + r.selection.spliceBoundaryRejected >= 2);
});
test('all seven enzymes expose independent guides, pair assessment, backups and missing evidence', () => {
  for (const enzyme of ['spcas9', 'spcas9ng', 'sacas9', 'spry', 'ascas12a', 'lbcas12a', 'mad7']) {
    const r = runDesign('ko', text, '', '', 400, { enzyme });
    assert.ok(!r.err, `${enzyme}: ${r.err}`);
    const s = r.koSelection;
    assert.equal(s.independentGuides.length, 2); assert.ok(s.pairCandidatesEvaluated > 0);
    assert.ok(s.independentPair); assert.ok(s.recommendedPair);
    for (const g of [...s.independentGuides, ...s.backups, ...s.recommendedPair.guides]) {
      assert.ok(g.gc >= 40 && g.gc <= 60); assert.ok(g.spliceMargin > 10);
      assert.equal(g.coveredIsoforms, s.isoformsEvaluated);
    }
    assert.ok(s.unassessed.includes('Genome-wide off-target specificity'));
    assert.ok(describeKoSelection(s).some(line => /Best individual guides/.test(line)));
    assert.match(buildDesignSummary(r), /Recommended coordinated pair/);
    if (enzyme !== 'spcas9') assert.equal(r.koAssessment.outcomes, null);
  }
});
test('coding annotations are deduplicated and are no longer silently capped at eight', () => {
  const m = { gene: 'X', genomicSequence: 'GCT'.repeat(200), cdsSegments: [[0, 600]], cdsSequence: 'GCT'.repeat(200) };
  m.rawFeatures = Array.from({ length: 12 }, (_, i) => ({ type: 'CDS', loc: `${i * 3 + 1}..600`, q: { gene: 'X', transcript_id: `T${i}` } }));
  assert.equal(codingModels(m).length, 12);
});

test('a missing coordinated pair preserves the independent recommendations in its diagnostic', () => {
  const r = selectFunctionalKoGuides(model(), [guide('GCGCGCGCATATATATATAT', 14420), guide('GCGCGCGCATATATATATAT', 14630)]);
  assert.match(r.err, /spacing requirement/);
  assert.equal(r.selection.independentGuides.length, 2);
  assert.equal(r.selection.recommendedPair, null);
  assert.ok(r.selection.independentGuides.every(g => Array.isArray(g.isoformGaps)));
});
