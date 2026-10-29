import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runDesign } from '../src/engine/design/designEngine.js';
import { buildCoveredAlleleReviewBatch } from '../src/services/alphaGenomeAlleles.js';
import { reviewEditedAllele, designReviewUpdate } from '../src/services/alleleWorkflow.js';

const raw = fs.readFileSync(new URL('../public/references/tp53-NG_017013.2.gb', import.meta.url), 'utf8');
const project = () => ({ gene: 'TP53', genbankRaw: raw, designResult: runDesign('ko', raw, '', '', 400, { expectedGene: 'TP53', deliveryMethod: 'rnp' }) });
const ONTOLOGY = 'EFO:0009747';

const completed = batch => {
  const request = batch.candidates[0].request;
  return { schema: 'assured-alphagenome-allele-review/1', status: 'complete', evidenceType: 'model-prediction',
    requestId: batch.requestId, sourceId: batch.sourceId, alleleRequestId: request.requestId,
    candidates: [{ id: 'edited-allele', status: 'complete' }], ontologyTerms: request.ontologyTerms,
    modelVersion: 'ALL_FOLDS', sdkVersion: 'test', createdAt: 'test', annotationFullyCovered: true,
    conclusion: 'Target disruption supported by sequence', structuralEvidence: { deletedBp: 47, insertedBp: 0, codingBasesRemoved: 47 },
    targetTracks: request.requestedOutputs.map(output => ({ output, name: 'test', referenceMean: 1, editedMean: 1, signedRelativeChange: 0, maxAbsDelta: 0 })),
    neighborStatus: 'unavailable', neighborTracks: [], limitations: ['Protein loss unconfirmed.'] };
};

test('the design page and the evidence page submit the same allele review request', async () => {
  const p = project();
  const expected = await buildCoveredAlleleReviewBatch(p, { ontologyTerm: ONTOLOGY });
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(completed(expected)), { status: 200 });
  };
  const { report } = await reviewEditedAllele(p, { ontologyTerm: ONTOLOGY, fetchFn });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/alphagenome/compare');
  assert.equal(sent[0].body.requestId, expected.requestId);
  assert.equal(report.conclusion, 'Target disruption supported by sequence');
});

test('a completed review is recorded on the project with its cell context and binding source', async () => {
  const p = project();
  const batch = await buildCoveredAlleleReviewBatch(p, { ontologyTerm: ONTOLOGY });
  const fetchFn = async () => new Response(JSON.stringify(completed(batch)), { status: 200 });
  const update = await designReviewUpdate(p, { ontology: ONTOLOGY }, { fetchFn });
  assert.equal(update.alleleReviewContext, ONTOLOGY);
  assert.equal(update.alleleReview.conclusion, 'Target disruption supported by sequence');
  assert.ok(update.alleleReviewSource.includes('TP53'));
});

test('a refused review surfaces the reviewer message instead of a report', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ error: 'Prediction temporarily unavailable' }), { status: 503 });
  await assert.rejects(reviewEditedAllele(project(), { ontologyTerm: ONTOLOGY, fetchFn }), /Prediction temporarily unavailable/);
});
