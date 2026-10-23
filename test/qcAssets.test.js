import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchTraceAsset, fetchQcSpecAsset } from '../src/services/qcAssets.js';
import { parseAbif } from '../src/engine/qc/abif.js';
const trace = fs.readFileSync(new URL('../public/demo_traces/apoe_control.ab1', import.meta.url));

test('bundled QC downloads resolve under the deployed Studio base and parse as ABIF', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(url);
    return new Response(String(url).endsWith('.json') ? JSON.stringify({ schema: 'assured-qc-design/1' }) : trace);
  });
  const buffer = await fetchTraceAsset('/demo_traces/apoe_control.ab1', '/studio/');
  assert.ok(parseAbif(buffer, 'control').calls.length);
  await fetchQcSpecAsset('/drive_data/spec.json', '/studio/');
  assert.deepEqual(urls, ['/studio/demo_traces/apoe_control.ab1', '/studio/drive_data/spec.json']);
});

test('failed HTTP downloads never reach the AB1 parser', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('The page could not be found', { status: 404 }));
  await assert.rejects(fetchTraceAsset('demo_traces/missing.ab1'), /missing.ab1.*HTTP 404/);
  await assert.rejects(fetchQcSpecAsset('missing.json'), /HTTP 404/);
});

test('HTML and truncated success responses get a download error, not a parser error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>'.repeat(100)));
  await assert.rejects(fetchTraceAsset('trace.ab1'), /not a valid AB1/);
  t.mock.method(globalThis, 'fetch', async () => new Response('ABIF'));
  await assert.rejects(fetchTraceAsset('trace.ab1'), /not a valid AB1/);
});
