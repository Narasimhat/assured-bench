import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseQcDesign } from '../src/services/qcDesignImport.js';
import { runDesign } from '../src/engine/design/designEngine.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { createProject, updateProject } from '../src/services/projectState.js';
import { buildPairs, readDesign, reportDonors, readDesignForForm } from '../src/engine/qc/quick.js';
import { buildReportHtml } from '../src/engine/design/reportHtml.js';
const sample = JSON.parse(fs.readFileSync(new URL('../public/demo_traces/apoe_r176c_snp.design.json', import.meta.url)));

test('QC imports the design tool JSON handoff with its actual gene and edit type', () => {
  const { spec } = parseQcDesign(JSON.stringify(sample));
  assert.deepEqual(spec, sample);
});

test('QC imports a Bench project and preserves terminal-tag reference and guides', () => {
  const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');
  const result = runDesign('ct', raw, '', 'FLAG', 400, { expectedGene: 'TP53', deliveryMethod: 'rnp' });
  const { spec } = parseQcDesign(JSON.stringify({ ...createProject(), designResult: result }));
  assert.deepEqual(spec, buildQcDesignSpec(result));
  assert.equal(spec.design.gene, 'TP53');
  assert.notEqual(spec.design.editKind, 'snp');
});

test('QC rejects unrelated JSON and designs inconsistent with their reference', () => {
  for (const value of [null, [], { gene: 'TP53' }, { ...sample, reference: { sequence: '' } },
    { ...sample, guides: [{ name: 'bad', spacer: 'AAAA', cut: -1 }] }, { ...sample, guides: {} }]) {
    assert.throws(() => parseQcDesign(JSON.stringify(value)));
  }
});

test('changing design inputs drops an imported QC reference; switching QC design clears only QC output', () => {
  const project = { ...createProject(), gene: 'TP53', designResult: { type: 'ct' }, qcDesignSpec: sample, qcResults: [{ name: 'old' }] };
  const changed = updateProject(project, { gene: 'APOE' });
  assert.equal(changed.qcDesignSpec, null);
  assert.deepEqual(changed.qcResults, []);
  const switched = updateProject(project, { qcDesignSpec: null });
  assert.equal(switched.designResult, project.designResult);
  assert.deepEqual(switched.qcResults, []);
});

test('buildPairs pairs edited clones explicitly with uploaded Parental Control traces without relying on filename heuristics', () => {
  const traceNames = ['Arbitrary_Ref_A01.ab1', 'Sample_1_F.ab1', 'Sample_1_R.ab1', 'Sample_2.ab1'];
  const built = buildPairs({ traceNames, explicitControls: ['Arbitrary_Ref_A01.ab1'] });
  assert.equal(built.source, 'explicit');
  assert.equal(built.pairs.length, 2);
  assert.deepEqual(built.pairs[0].control, ['Arbitrary_Ref_A01.ab1']);
  assert.deepEqual(built.pairs[0].edited, ['Sample_1_F.ab1', 'Sample_1_R.ab1']);
  assert.equal(built.pairs[0].confidence, 'explicit');
  assert.deepEqual(built.pairs[1].edited, ['Sample_2.ab1']);
});

test('HTML and JSON design imports preserve all matched gRNAs and all ssODN donors', () => {
  const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');
  const pmResult = runDesign('pm', raw, 'R175H', '', 400, { expectedGene: 'TP53', deliveryMethod: 'rnp', ensureGuidePair: true });
  assert.equal(pmResult.gs.length, 2);
  assert.equal(pmResult.os.length, 2);

  const html = buildReportHtml({ gene: 'TP53', projectType: 'pm', deliveryMethod: 'rnp' }, pmResult, 'tp53.gb', null, []);
  const parsed = readDesign(html);
  assert.equal(parsed.kind, 'report');
  assert.equal(parsed.guides.length, 2);
  assert.equal(parsed.donors.length, 2);

  const resolvedDonors = reportDonors(parsed.donors);
  assert.equal(Array.isArray(resolvedDonors), true);
  assert.equal(resolvedDonors.length, 2);

  const formView = readDesignForForm(html);
  assert.equal(formView.donors.length, 2);
  assert.equal(formView.donor.split('\n').length, 2);
});
