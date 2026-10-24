import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, reference, spacer, syntheticTrace, traceOf } from './enzyme-fixtures.js';
import { locateGuide } from '../src/engine/qc/nucleases.js';
import { reverseComplement } from '../src/engine/qc/seq.js';
import { reverseSpec, validateDesignSpec } from '../src/engine/qc/designSpec.js';
import { planDesign, analyseSample } from '../src/engine/qc/batch.js';
import { analysePair } from '../src/engine/qc/analyze.js';
import { buildExpectedAlleles } from '../src/engine/qc/alleleLibrary.js';
import { parseDesignReport } from '../src/engine/qc/designReport.js';
import { readDesignForForm, readDesign, planTasks } from '../src/engine/qc/quick.js';
import { planIceExport } from '../src/engine/qc/iceExport.js';
import { buildQcReportHtml, buildResultsCsv } from '../src/engine/qc/report.js';
const near = (actual, expected, tolerance = 5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
for (const nuclease of ['AsCas12a', 'LbCas12a', 'Mad7']) {
  test(`${nuclease}: exact forward/reverse geometry, import, unknown/conflicting metadata rejection`, () => {
    const spec = fixture(nuclease);
    assert.deepEqual(spec.guides[0].cuts, { target: 247, non_target: 242 });
    assert.equal(spec.guides[0].pamStart, 220);
    assert.equal(spec.guides[0].pamEnd, 224);
    assert.deepEqual(validateDesignSpec(spec).errors, []);
    const reversed = reverseSpec(spec);
    assert.deepEqual(validateDesignSpec(reversed).errors, []);
    assert.deepEqual(reverseSpec(reversed), spec);
    const placed = locateGuide(reverseComplement(reference), spacer, nuclease);
    assert.equal(placed.strand, '-');
    assert.deepEqual(placed.cuts, reversed.guides[0].cuts);
    const broken = structuredClone(spec); broken.guides[0].cuts.non_target++;
    assert.equal(validateDesignSpec(broken).ok, false);
    const unknown = structuredClone(spec); unknown.design.nuclease = 'UnknownCas';
    assert.equal(validateDesignSpec(unknown).ok, false);
    const conflict = structuredClone(spec); conflict.guides[0].enzyme = 'spcas9';
    assert.equal(validateDesignSpec(conflict).ok, false);
    const manual = planDesign({ control: traceOf(reference), guides: [spacer], nuclease });
    assert.ok(!manual.error, manual.error);
    assert.deepEqual(manual.spec.guides[0].cuts, spec.guides[0].cuts);
    assert.deepEqual(validateDesignSpec(manual.spec).errors, []);
  });
  test(`${nuclease}: WT, heterozygous and homozygous one-base edits at the non-target boundary; both read directions`, () => {
    const spec = fixture(nuclease), cut = spec.guides[0].cuts.non_target;
    const deleted = reference.slice(0, cut) + reference.slice(cut + 1);
    assert.ok(buildExpectedAlleles(spec).alleles.some(a => a.sequence === deleted));
    const inserted = reference.slice(0, cut) + 'G' + reference.slice(cut);
    assert.ok(buildExpectedAlleles(spec).alleles.some(a => a.sequence === inserted));
    for (const fraction of [0, .5, 1]) {
      const control = traceOf(reference), edited = syntheticTrace([{ sequence: reference, fraction: 1 - fraction }, { sequence: deleted, fraction }]);
      for (const reverse of [false, true]) {
        const result = analysePair({ control: reverse ? traceOf(reverseComplement(reference)) : control, edited: reverse ? syntheticTrace([{ sequence: reverseComplement(reference), fraction: 1 - fraction }, { sequence: reverseComplement(deleted), fraction }]) : edited, spec, options: { intervals: false } });
        assert.ok(result.ok, result.error);
        near(result.summary.editedPct, fraction * 100);
        assert.equal(result.prepared.lastCut - result.prepared.firstCut, 5);
        assert.ok(result.warnings.some(w => /Staggered-break/.test(w)));
      }
    }
  });
  test(`${nuclease}: two-guide staggered deletion, intended SNP and partial donor conversion use the standard reports`, () => {
    const spec = fixture(nuclease, true);
    assert.deepEqual(validateDesignSpec(spec).errors, []);
    const left = spec.guides[0].cuts.non_target, right = spec.guides[1].cuts.target;
    const deleted = reference.slice(0, left) + reference.slice(right);
    assert.ok(buildExpectedAlleles(spec).alleles.some(a => a.sequence === deleted));
    const pair = analysePair({ control: traceOf(reference), edited: traceOf(deleted), spec, options: { intervals: false } });
    assert.ok(pair.ok, pair.error); near(pair.summary.betweenCutsPct, 100);
    const snp = fixture(nuclease); snp.design.editKind = 'snp';
    snp.markers = [250, 255].map((pos, i) => ({ pos, ref: reference[pos], alt: reference[pos] === 'A' ? 'G' : 'A', role: i ? 'blocking' : 'intended' }));
    const apply = markers => [...reference].map((b, i) => markers.find(m => m.pos === i)?.alt || b).join('');
    const repaired = apply(snp.markers), partial = apply(snp.markers.slice(1));
    snp.donors = [{ name: 'ssODN', sequence: repaired.slice(190, 310), refStart: 190, refEnd: 310, insertBp: 0, carriesMarkers: [250, 255] }];
    assert.deepEqual(validateDesignSpec(snp).errors, []);
    const result = analyseSample({ name: 'clone', spec: snp, control: traceOf(reference), edited: syntheticTrace([{ sequence: repaired, fraction: .5 }, { sequence: partial, fraction: .5 }]), options: { intervals: false } });
    assert.ok(result.ok, result.error); near(result.summary.intendedEditPct, 50); near(result.summary.partialConversionPct, 50);
    const tagged = fixture(nuclease); tagged.design.editKind = 'tag_small';
    const insert = 'ACCGGTGAA', at = 250;
    const tagAllele = reference.slice(0, at) + insert + reference.slice(at);
    tagged.donors = [{ name: 'tag', sequence: reference.slice(190, at) + insert + reference.slice(at, 310), refStart: 190, refEnd: 310, insertStart: at, insertBp: insert.length, replacedBp: 0, arm5: 60, arm3: 60 }];
    assert.deepEqual(validateDesignSpec(tagged).errors, []);
    const tagRead = analysePair({ control: traceOf(reference), edited: traceOf(tagAllele), spec: tagged, options: { intervals: false } });
    assert.ok(tagRead.ok, tagRead.error); near(tagRead.summary.intendedEditPct, 100);
    assert.equal(result.nuclease, nuclease);
    assert.equal(result.view.guides[0].pam[1] - result.view.guides[0].pam[0] + 1, 4);
    assert.equal(Math.abs(result.view.guides[0].cuts.target - result.view.guides[0].cuts.non_target), 5);
    assert.equal(planIceExport([{ spec: snp, name: 'clone', nuclease: 'SpCas9' }]).rows.length, 0);
    assert.ok(buildResultsCsv('snp', [result]).includes(nuclease));
    assert.ok(buildQcReportHtml({ workflow: 'snp', results: [result] }).includes(nuclease));
    const html = `<h1>Test</h1><h2>1. Gene Information</h2><table><tr><th>Gene</th><td>Test</td><th>Enzyme</th><td>${nuclease} · TTTV (5′ PAM) · config 1.1.0</td></tr></table><h2>2. gRNA Sequences</h2><table><tr><td>gRNA1</td><td>TTTA ${spacer}</td></tr></table>`;
    assert.equal(parseDesignReport(html)[0].guides[0].sequence, spacer);
    assert.equal(readDesignForForm(html).nuclease, nuclease);
    const design = readDesign(html), samplePair = { sample: 'clone', control: ['wt'], edited: ['edited'] };
    const getTrace = () => traceOf(reference);
    const planned = planTasks({ pairs: [samplePair], getTrace, design });
    assert.deepEqual(planned.problems, []);
    assert.equal(planned.tasks[0].spec.design.nuclease, nuclease);
    const conflicted = planTasks({ pairs: [{ ...samplePair, nuclease: 'SpCas9' }], getTrace, design });
    assert.equal(conflicted.tasks.length, 0);
    assert.match(conflicted.problems[0], /conflicts/);
  });
}
test('Mad7 YTTN PAM is distinct from the Cas12a TTTV PAM', () => {
  const seq = 'AAAACTTA' + spacer + 'AAAA';
  assert.equal(locateGuide(seq, spacer, 'Mad7').pamOk, true);
  assert.equal(locateGuide(seq, spacer, 'AsCas12a').pamOk, false);
  assert.ok(locateGuide(seq, spacer, 'MisspelledCas').error);
});

test('opposite-strand two-guide deletion uses the outer strand boundaries rather than the Cas9 cut tolerance', () => {
  const spec = fixture('LbCas12a', true);
  const seq = reference.slice(0, 300) + reverseComplement(reference.slice(300, 327)) + reference.slice(327);
  spec.reference.sequence = seq;
  const found = locateGuide(seq, spec.guides[1].spacer, 'LbCas12a');
  assert.equal(found.strand, '-');
  spec.guides[1] = { ...spec.guides[1], ...found, protospacerStart: found.start, protospacerEnd: found.end };
  assert.deepEqual(validateDesignSpec(spec).errors, []);
  const left = spec.guides[0].cuts.non_target, right = spec.guides[1].cuts.non_target;
  const edit = seq.slice(0, left) + seq.slice(right);
  const result = analysePair({ control: traceOf(seq), edited: traceOf(edit), spec, options: { intervals: false } });
  assert.ok(result.ok, result.error); near(result.summary.betweenCutsPct, 100);
});
