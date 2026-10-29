import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = TestRenderer;
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');

test('an active or failed TP53 allele review never displays the idle predictions-not-run message', async t => {
 const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, logLevel: 'error' });
 let mounted;
 try {
  const { runDesign } = await vite.ssrLoadModule('/src/engine/design/designEngine.js');
  const { AlphaGenomeAlleleReview } = await vite.ssrLoadModule('/src/components/design/AlphaGenomeAlleleReview.jsx');
  const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');
  const project = { id:'progress-test', gene:'TP53', genbankRaw:raw, alleleReviewContext:'EFO:0009747', designResult:runDesign('ko',raw,'','',400,{expectedGene:'TP53',deliveryMethod:'rnp'}) };
  let finish;
  t.mock.method(globalThis,'fetch',async url => {
   if(String(url).endsWith('/status')) return new Response(JSON.stringify({available:true,authenticated:true,authenticationRequired:true}));
   if(String(url).endsWith('/compare')) return new Promise(resolve => { finish=resolve; });
   throw new Error('Unexpected network request');
  });
  await act(async()=>{ mounted=TestRenderer.create(React.createElement(AlphaGenomeAlleleReview,{project,onUpdateProject(){}})); });
  for(let i=0;i<10;i++) await act(async()=>{ await new Promise(resolve=>setTimeout(resolve,5)); });
  assert.match(text(mounted.toJSON()),/Predictions not run for this allele/);
  const button=mounted.root.findAll(n=>n.type==='button'&&text(n)==='Review edited allele')[0];
  assert.equal(button.props.disabled,false);
  let pending;
  await act(async()=>{ pending=button.props.onClick(); await Promise.resolve(); });
  assert.doesNotMatch(text(mounted.toJSON()),/Predictions not run/);
  assert.match(text(mounted.toJSON()),/Waiting for the RNA expression and splicing report/);
  assert.equal(mounted.root.findAll(n=>n.props.role==='status').length,1);
  await act(async()=>{ finish(new Response(JSON.stringify({error:'Prediction temporarily unavailable'}),{status:503})); await pending; });
  assert.match(text(mounted.toJSON()),/Prediction temporarily unavailable/);
  assert.doesNotMatch(text(mounted.toJSON()),/Predictions not run/);
  assert.match(text(mounted.toJSON()),/Your selected design is unchanged/);
 } finally { if(mounted) await act(async()=>mounted.unmount()); await vite.close(); }
});
