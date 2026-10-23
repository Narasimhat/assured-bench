import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseQcDesign } from '../src/services/qcDesignImport.js';
import { runDesign } from '../src/engine/design/designEngine.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { createProject, updateProject } from '../src/services/projectState.js';
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
