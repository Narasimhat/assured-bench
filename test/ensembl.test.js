import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fetchGeneGenbank } from '../src/services/ensembl.js';
import { parseGB, runDesign, summarizeProcurementReadiness } from '../src/engine/design/designEngine.js';
import { normalizeGenBankToTranscriptModel } from '../src/engine/design/transcriptModel.js';
import { buildQcDesignSpec } from '../src/engine/design/qcExport.js';
import { alphaGenomeMapping, buildAlphaGenomeRequest } from '../src/services/alphaGenomeReview.js';
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

for (const strand of [1, -1]) {
  test(`Ensembl ${strand === -1 ? 'reverse' : 'forward'} strand lookup retains biological exon order, CDS and transcript version`, async t => {
    const geneStart = 2001, geneEnd = 2051, referenceStart = geneStart - 1500;
    const sequence = Array(geneEnd - geneStart + 1 + 3000).fill('A');
    const exonStarts = [2001, 2021, 2046];
    const biologicalExons = ['ATGAAA', 'CCCGGG', 'AAATAA'];
    const rc = s => [...s].reverse().map(b => ({ A:'T', T:'A', C:'G', G:'C' }[b])).join('');
    for (let i = 0; i < exonStarts.length; i++) {
      const payload = strand === 1 ? biologicalExons[i] : rc(biologicalExons[2-i]);
      sequence.splice(exonStarts[i] - referenceStart, 6, ...payload);
    }
    const gene = {
      id: 'ENSG_SYN', display_name: 'TESTGENE', seq_region_name: '10', assembly_name: 'GRCh38',
      canonical_transcript: 'ENST_SYN.7', Transcript: [{
        id: 'ENST_SYN', version: 7, is_canonical: 1, start: geneStart, end: geneEnd, strand,
        Exon: exonStarts.map((start, i) => ({ start, end: start + 5, id: `EX${i}` })),
        Translation: { start: geneStart, end: geneEnd, id: 'ENSP_SYN', length: 5 },
      }],
    };
    t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
      String(url).includes('/lookup/') ? gene : { seq: sequence.join('') }
    )));
    const ref = await fetchGeneGenbank('TESTGENE');
    const model = normalizeGenBankToTranscriptModel(parseGB(ref.genbankText), { expectedGene: 'TESTGENE' });
    assert.equal(ref.transcriptId, 'ENST_SYN.7');
    assert.match(ref.genbankText, /VERSION     ENST_SYN\.7\n/);
    assert.equal(ref.referenceOrientation, 'gene');
    assert.equal(model.cdsSequence, biologicalExons.join(''));
    assert.equal(model.proteinLength, 5);
    assert.deepEqual(model.referenceIssues, []);
    assert.deepEqual(model.exons.map(e => e.exonNumber), [1, 2, 3]);
    assert.equal(model.genomicSequence.slice(model.cdsSegments[0][0], model.cdsSegments[0][0] + 3), 'ATG');
    if (strand === -1) assert.match(ref.warning, /relative to this reference, not chromosome plus/);
    const mapping=alphaGenomeMapping({genbankRaw:ref.genbankText});
    assert.deepEqual(mapping,{assembly:'GRCh38',chromosome:'10',referenceStart,orientation:strand});
    const index=model.cdsSegments[0][0]+4, donorStart=index-54;
    const donor=model.genomicSequence.slice(donorStart,donorStart+127).split('');donor[54]='G';
    const request=await buildAlphaGenomeRequest({genbankRaw:ref.genbankText,gene:'TESTGENE',designResult:{type:'pm',gene:'TESTGENE',gp:index,gb:model,gs:[],ps:[],os:[{n:'test-donor',donorStart,donorEnd:donorStart+127,genomicDonor:donor.join(''),desiredDiffIndexes:[54]}]}},{...mapping,ontologyTerm:'EFO:0009747',mappingConfirmed:true});
    const expectedPosition=strand===1?geneStart+4:geneEnd-4;
    assert.deepEqual(request.variants,[{position:expectedPosition,ref:strand===1?'A':'T',alt:strand===1?'G':'C',role:'intended'}]);
    assert.equal(request.reference.sequence,sequence.join(''),'AlphaGenome receives the original chromosome-plus sequence on either strand');
  });
}

test('canonical accession wins over a conflicting flag and metadata preserves the actual species and assembly', async t => {
  const selected = { id: 'ENST_REAL.9', is_canonical: 0, start: 2001, end: 2009, strand: 1,
    Exon: [{ start: 2001, end: 2009 }], Translation: { start: 2001, end: 2009 } };
  const gene = { id: 'ENSG_TEST', display_name: 'TESTGENE', seq_region_name: '1', assembly_name: 'GRCm39',
    canonical_transcript: 'ENST_REAL.9', Transcript: [{ ...selected, id: 'ENST_OTHER', is_canonical: 1 }, selected] };
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
    String(url).includes('/lookup/') ? gene : { seq: 'A'.repeat(3009) }
  )));
  const result = await fetchGeneGenbank('TESTGENE', 'mus_musculus');
  assert.equal(result.transcriptId, 'ENST_REAL.9');
  assert.equal(result.isCanonical, true);
  assert.match(result.genbankText, /ORGANISM  Mus musculus/);
  assert.doesNotMatch(result.genbankText, /GRCh38|MANE Select|ENST_REAL\.9\.1/);
  assert.equal(alphaGenomeMapping({ genbankRaw: result.genbankText }).assembly, 'GRCm39');
  delete gene.assembly_name;
  const unknown = await fetchGeneGenbank('TESTGENE', 'mus_musculus');
  assert.equal(unknown.assembly, null);
  assert.equal(alphaGenomeMapping({ genbankRaw: unknown.genbankText }), null);
  assert.match(unknown.genbankText, /assembly not reported/);
});

test('mismatched or invalid Ensembl sequence responses fail before building a reference', async t => {
  const gene = { id: 'ENSG_TEST', display_name: 'TESTGENE', seq_region_name: '1', canonical_transcript: 'ENST_TEST',
    Transcript: [{ id: 'ENST_TEST', start: 2001, end: 2009, strand: 1, Exon: [], Translation: { start: 2001, end: 2009 } }] };
  let sequence = 'A'.repeat(3008);
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
    String(url).includes('/lookup/') ? gene : { seq: sequence }
  )));
  await assert.rejects(fetchGeneGenbank('TESTGENE'), /does not match the requested genomic interval/);
  sequence = 'X'.repeat(3009);
  await assert.rejects(fetchGeneGenbank('TESTGENE'), /does not match the requested genomic interval/);
});
