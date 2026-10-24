import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runDesign } from '../src/engine/design/designEngine.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { validateDesignSpec, reverseSpec } from '../src/engine/qc/designSpec.js';
import { parseQcDesign } from '../src/services/qcDesignImport.js';
import { generateIdtOrderRows, generateSynthegoOrderRows } from '../src/services/vendorExport.js';
import { generateReportHtml } from '../src/services/designExport.js';
import { createProject, updateProject, parseProject } from '../src/services/projectState.js';
const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');
for (const enzyme of ['ascas12a', 'lbcas12a', 'mad7']) {
  test(`${enzyme}: TP53 two-guide design survives report, vendor ordering, QC and reverse-read handoff`, () => {
    const result = runDesign('ko', raw, '', '', '', { enzyme, deliveryMethod: 'rnp' });
    assert.ok(!result.err, result.err);
    assert.equal(result.gs.length, 2);
    const project = { ...createProject(), gene: 'TP53', designResult: result };
    const spec = buildQcDesignSpec(result);
    assert.ok(!spec.err, spec.err);
    assert.deepEqual(validateDesignSpec(spec).errors, []);
    assert.deepEqual(validateDesignSpec(reverseSpec(spec)).errors, []);
    assert.equal(spec.design.nuclease, result.enzyme.name);
    assert.deepEqual(parseQcDesign(JSON.stringify(spec)).spec, spec);
    assert.match(generateReportHtml(project, result), new RegExp(result.enzyme.name));
    for (const generate of [generateIdtOrderRows, generateSynthegoOrderRows]) {
      const rows = generate({ input: { gene: 'TP53' }, result });
      const guides = rows.filter(row => row.itemType === 'crRNA');
      assert.equal(guides.length, 2);
      assert.equal(guides[0].sequence, result.gs[0].sp);
      assert.match(guides[0].notes, /Spacer only/);
      assert.ok(!JSON.stringify(rows).includes('≤0.023'));
      assert.ok(!guides.some(row => row.product.includes('Cas9')));
      const full = { ...result, gs: result.gs.map(g => ({ ...g, full_crrna: 'UAAU' + g.sp.replace(/T/g, 'U') })) };
      assert.equal(generate({ result: full })[0].sequence, full.gs[0].full_crrna);
    }
    const damaged = structuredClone(spec);
    damaged.guides[0].cuts.non_target += 1;
    assert.equal(validateDesignSpec(damaged).ok, false);
  });
}
test('enzyme input changes clear stale reports/QC and persist in portable projects', () => {
  const previous = { ...createProject(), designResult: { type: 'ko' }, qcResults: [{ name: 'old' }] };
  const next = updateProject(previous, { options: { ...previous.options, enzyme: 'lbcas12a' } });
  assert.equal(next.designResult, null);
  assert.deepEqual(next.qcResults, []);
  assert.equal(parseProject(JSON.stringify(next)).options.enzyme, 'lbcas12a');
});
