import test from 'node:test';
import assert from 'node:assert/strict';
import { snpDonorWindow } from '../src/engine/design/snpDonorPolicy.js';
import { runDesign, mkODN, parseGB, toAA } from '../src/engine/design/designEngine.js';
import { planEnzymeModification } from '../src/engine/design/enzymeEditPlan.js';
import { normalizeGenBankToTranscriptModel } from '../src/engine/design/transcriptModel.js';
import { reverseComplementDna as rc } from '../src/engine/design/enzymeGuides.js';
import { designGenomicSnp } from '../src/engine/design/genomicSnp.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { buildReportHtml } from '../src/engine/design/reportHtml.js';
const flank = 'GAC'.repeat(100), site = 'TTTAACGTCAGTCAGTACGATCGATCA';
const cds = 'ATG' + site + 'GCTAACATC' + 'GAAAAC' + 'GCT'.repeat(60) + 'TAA';
function genbank(sequence, start, end, exonStart = start, exonEnd = end) {
  return `LOCUS       TEST ${sequence.length} bp DNA\nFEATURES             Location/Qualifiers\n     gene            1..${sequence.length}\n                     /gene="TEST"\n     exon            ${exonStart+1}..${exonEnd}\n     CDS             ${start+1}..${end}\n                     /gene="TEST"\n                     /codon_start=1\nORIGIN\n1 ${sequence.toLowerCase()}\n//\n`;
}
const sequence = flank + cds + flank;
const gb = genbank(sequence, 300, 300 + cds.length);
const translate = s => s.match(/.../g).map(toAA).join('');

test('the SNP policy keeps the 91 nt flank toward the PAM on both strands and leaves Cas9 unchanged', () => {
  assert.deepEqual(snpDonorWindow(1000, 400, '+'), { start: 364, end: 491 });
  assert.deepEqual(snpDonorWindow(1000, 400, '-'), { start: 309, end: 436 });
  assert.deepEqual(snpDonorWindow(1000, 5, '+'), { start: 0, end: 127 });
  assert.deepEqual(snpDonorWindow(1000, 990, '-'), { start: 873, end: 1000 });
  assert.deepEqual(snpDonorWindow(1000, 400, '+', '5prime'), { start: 309, end: 436 });
  assert.deepEqual(snpDonorWindow(1000, 400, '-', '5prime'), { start: 364, end: 491 });
  assert.equal(snpDonorWindow(126, 50, '+'), null);
});
for (const enzyme of ['mad7', 'ascas12a', 'lbcas12a']) {
  test(`${enzyme}: stale tag arm/format/strand settings cannot change SNP donor length or Cas9-style ordering`, () => {
    const result = runDesign('pm', gb, 'S5A', '', 400, { enzyme, donorFormat: 'block', arm3Length: 500, donorStrand: 'sense', coDeliveryBlocking: true, deliveryMethod: 'rnp' });
    assert.ok(!result.err, result.err);
    assert.equal(result.os.length, 2);
    assert.ok(result.gs.some(g=>g.str === '+') && result.gs.some(g=>g.str === '-'));
    for (const donor of result.os) {
      const guide = result.gs[donor.gi];
      assert.equal(donor.od.length, 127);
      assert.equal(donor.donorStart, guide.cut - (guide.str === '+' ? 91 : 36));
      assert.equal(donor.donorEnd, guide.cut + (guide.str === '+' ? 36 : 91));
      assert.equal(donor.orderStrand, guide.str === '+' ? 'antisense' : 'sense');
      assert.equal(donor.od, guide.str === '+' ? rc(donor.genomicDonor) : donor.genomicDonor);
      assert.ok(donor.proteinValidation.valid);
      assert.ok(donor.guideProtection.every(p=>p.tier==='strong'));
      assert.ok(donor.edits.some(e=>e.kind==='synonymous_pam'));
      const model = normalizeGenBankToTranscriptModel(parseGB(gb));
      const desired = result.ch.map(c=>c.p), bases = result.ch.map(c=>c.m);
      const comparator = mkODN(model, guide, desired, bases, donor.edits.filter(e=>e.kind.startsWith('synonymous_')).map(e=>({gp:e.start,nb:e.sequence})));
      assert.equal(donor.od, comparator.od);
    }
    assert.ok(!buildQcDesignSpec(result).err);
    assert.match(buildReportHtml({projectType:'pm',gene:'TEST'}, result, 'TEST.gb', null, []), /127/);
  });
  test(`${enzyme}: UTR PAM without a silent PAM option uses a synonymous seed fallback and retains an unscored review warning`, () => {
    const coding = 'ATGGCTAACGTCAGTCAGTACGATCGATCA' + 'GCT'.repeat(35) + 'TAA';
    const raw = genbank(flank + 'TTTA' + coding + flank, 304, 304 + coding.length, 100, 304 + coding.length + 100);
    const result = runDesign('pm', raw, 'N3K', '', '', {enzyme, coDeliveryBlocking:false, deliveryMethod:'rnp'});
    assert.ok(!result.err, result.err);
    const donor = result.os.find(d=>d.edits.some(e=>e.kind==='synonymous_seed'));
    assert.ok(donor, 'A protein-preserving seed fallback must be proposed');
    assert.equal(donor.od.length,127);
    assert.ok(donor.proteinValidation.valid);
    const input = parseGB(raw).seq;
    const repaired = input.slice(0, donor.donorStart) + donor.genomicDonor + input.slice(donor.donorEnd);
    assert.equal(translate(repaired.slice(304, 304 + coding.length)), translate(coding).slice(0, 2) + 'K' + translate(coding).slice(3));
    assert.ok(donor.guideProtection.some(p=>p.tier==='weak' && p.cfd===null));
    assert.ok(donor.warnings.some(w=>/seed.*unavailable|seed.*uncalibrated/i.test(w)));
    assert.ok(result.ss.some(s=>s.blockingTier==='weak' && /seed/i.test(s.pur)));
    assert.ok(!result.coDeliverySafe);
    const genomic = designGenomicSnp(raw, {enzyme, gene:'TEST', assembly:'test', chromosome:'1', referenceStart:1, position:313, ref:'C', alt:'A', forwardConfirmed:true, blockingPolicy:'synonymous'});
    assert.ok(!genomic.err, genomic.err);
    assert.ok(genomic.candidates.some(c=>c.blockingChanges.some(change=>/seed/i.test(change.pur))));
    assert.ok(genomic.candidates.every(c=>c.donor.od.length===127));
  });
}
