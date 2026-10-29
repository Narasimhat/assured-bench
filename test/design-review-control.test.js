import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = TestRenderer;
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');

/** The review control must read the same on every edit type; a knockout must not quietly default to skipping it. */
test('every edit type offers the review on the design page and starts on "Choose cell type"', async () => {
 const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, logLevel: 'error' });
 const mounted = [];
 try {
  const { DesignView } = await vite.ssrLoadModule('/src/components/design/DesignView.jsx');
  const render = async project => {
   let tree;
   await act(async () => { tree = TestRenderer.create(React.createElement(DesignView, { currentProject: project, onUpdateProject(){}, onProceedToOrder(){}, onProceedToQc(){}, onLoadPreset(){} })); });
   mounted.push(tree);
   return tree;
  };
  const control = tree => tree.root.findAll(n => n.props?.['aria-label'] === 'Cell type for AlphaGenome review')[0];
  const action = tree => tree.root.findAll(n => n.type === 'button' && /Design and review|Generate design/.test(text(n)))[0];

  for (const editType of ['ko', 'pm', 'ct', 'nt']) {
   const tree = await render({ id: `t-${editType}`, gene: 'TP53', genbankRaw: raw, editType, mutation: editType === 'pm' ? 'R175H' : '', options: { enzyme: 'spcas9', deliveryMethod: 'rnp' } });
   const select = control(tree);
   assert.ok(select, `${editType} must offer the review control on the design page`);
   assert.equal(select.props.value, '', `${editType} must start with no cell type chosen`);
   const options = select.findAll(n => n.type === 'option').map(o => String(o.props.children));
   assert.equal(options[0], 'Choose cell type', `${editType} must not default to skipping the review`);
   assert.equal(text(action(tree)), 'Design and review', `${editType} must offer design-and-review`);
   assert.equal(action(tree).props.disabled, true, `${editType} must require a deliberate choice`);
  }

  // Skipping stays possible for the structural types, but only as an explicit choice.
  const skipped = await render({ id: 'skip', gene: 'TP53', genbankRaw: raw, editType: 'ko', alleleReviewSkipped: true, options: { enzyme: 'spcas9', deliveryMethod: 'rnp' } });
  assert.equal(text(action(skipped)), 'Generate design');
  assert.equal(action(skipped).props.disabled, false);
  const chosen = await render({ id: 'chosen', gene: 'TP53', genbankRaw: raw, editType: 'ko', alleleReviewContext: 'EFO:0009747', options: { enzyme: 'spcas9', deliveryMethod: 'rnp' } });
  assert.equal(text(action(chosen)), 'Design and review');
  assert.equal(action(chosen).props.disabled, false);
 } finally {
  for (const tree of mounted) await act(async () => tree.unmount());
  await vite.close();
 }
});
