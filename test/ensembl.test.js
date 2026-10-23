import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fetchGeneGenbank } from '../src/services/ensembl.js';
import { parseGB, runDesign, summarizeProcurementReadiness } from '../src/engine/design/designEngine.js';
import { normalizeGenBankToTranscriptModel } from '../src/engine/design/transcriptModel.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { buildDesignSchemeSvg } from '../src/engine/design/designScheme.js';

const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');

test('TP53 uses a labelled versioned local reference during an Ensembl server outage', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return String(url).includes('/references/') ? new Response(raw) : new Response('unavailable', { status: 500 });
  });
  const result = await fetchGeneGenbank(' tp53 ');
  assert.equal(result.referenceAccession, 'NG_017013.2');
  assert.equal(result.transcriptId, 'NM_000546.5');
  assert.match(result.warning, /Ensembl lookup failed/);
  assert.equal(result.genbankText, raw);
  assert.equal(calls[1], '/references/tp53-NG_017013.2.gb');
});

test('network failures fall back for TP53 stable ID; other targets get an actionable error', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/references/')) return new Response(raw);
    throw new TypeError('Failed to fetch');
  });
  const result = await fetchGeneGenbank('ENSG00000141510');
  assert.equal(result.geneSymbol, 'TP53');
  await assert.rejects(fetchGeneGenbank('SCN5A'), /Could not reach Ensembl.*upload a GenBank/);
  await assert.rejects(fetchGeneGenbank('TP53', 'mus_musculus'), /Could not reach Ensembl/);
});

test('a not-found result is not silently substituted and a missing local reference cannot succeed', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
  await assert.rejects(fetchGeneGenbank('TP53'), /HTTP 404/);
  t.mock.method(globalThis, 'fetch', async url => new Response('missing', { status: String(url).includes('/references/') ? 404 : 503 }));
  await assert.rejects(fetchGeneGenbank('TP53'), /HTTP 503/);
});

test('bundled TP53 reference checksum and primary CDS match the pinned annotation', () => {
  const provenance = JSON.parse(fs.readFileSync(new URL('../public/references/tp53-provenance.json', import.meta.url)));
  assert.equal(createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex'), provenance.derivedSha256);
  const model = normalizeGenBankToTranscriptModel(parseGB(raw), { expectedGene: 'TP53' });
  assert.equal(model.gene, 'TP53');
  assert.equal(model.transcriptId, 'NM_000546.5');
  assert.equal(model.proteinLength, 393);
  assert.equal(model.cdsSequence.length, 1182);
  assert.equal(model.cdsSequence.slice(0, 3), 'ATG');
  assert.equal(model.cdsSequence.slice(-3), 'TGA');
  assert.deepEqual(model.referenceIssues, []);
  assert.equal(parseGB(raw).feats.filter(f => f.type === 'CDS').length, 1);
});

test('TP53 C-terminal FLAG generates an in-frame donor, schematic and QC handoff', () => {
  const result = runDesign('ct', raw, '', 'FLAG', 400, {
    deliveryMethod: 'rnp', maxBlockingChanges: 3, ensureGuidePair: true,
    allowNonCodingBlockers: true, expectedGene: 'TP53'
  });
  assert.equal(result.err, undefined);
  assert.equal(result.gene, 'TP53');
  assert.equal(result.type, 'ct');
  assert.ok(result.gs.length > 0);
  assert.ok(result.ps.length === 2);
  assert.equal(result.insertValidation.actualAas.join(''), 'DYKDDDDKStop');
  assert.equal(result.insertValidation.framePreserved, true);
  assert.equal(result.insertValidation.unexpectedStop, false);
  assert.equal(result.insertValidation.terminalStopPresent, true);
  assert.deepEqual(result.proteinPreview.donorAas.slice(-9), ['D','Y','K','D','D','D','D','K','Stop']);
  assert.match(buildDesignSchemeSvg(result), /^<svg/);
  assert.equal(buildQcDesignSpec(result).schema, 'assured-qc-design/1');
  assert.equal(summarizeProcurementReadiness(result).blockers.length, 0);
});
