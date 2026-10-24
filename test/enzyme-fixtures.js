// Idealised, independent signal fixtures. These verify computation, not laboratory calibration.
import { locateGuide } from '../src/engine/qc/nucleases.js';
let state = 91;
const dna = n => Array.from({ length: n }, () => { state = (state * 1664525 + 1013904223) >>> 0; return 'ACGT'[(state >>> 16) % 4]; }).join('');
export const spacer = 'ACGTCAGTCAGTACGATCGATCA';
export const reference = dna(220) + 'TTTA' + spacer + dna(53) + 'TTTG' + dna(23) + dna(300);
export function fixture(nuclease = 'Mad7', twoGuides = false) {
  const placed = locateGuide(reference, spacer, nuclease);
  const guide = { name: 'g1', spacer, strand: '+', cut: placed.cut, cuts: placed.cuts, pam: placed.pam,
    protospacerStart: placed.start, protospacerEnd: placed.end, pamStart: placed.pamStart, pamEnd: placed.pamEnd };
  const guides = [guide];
  if (twoGuides) {
    const second = reference.slice(304, 327);
    const found = locateGuide(reference, second, nuclease);
    guides.push({ name: 'g2', spacer: second, strand: '+', cut: found.cut, cuts: found.cuts, pam: found.pam,
      protospacerStart: found.start, protospacerEnd: found.end, pamStart: found.pamStart, pamEnd: found.pamEnd });
  }
  return { schema: 'assured-qc-design/1', design: { gene: 'SYNTHETIC', type: 'ko', editKind: twoGuides ? 'deletion' : 'knockout', nuclease },
    reference: { sequence: reference, offset: 0, mirrored: false }, guides, donors: [], markers: [], primers: [], amplicons: [] };
}
export function syntheticTrace(alleles, length = Math.min(...alleles.map(a => a.sequence.length))) {
  const spacing = 9, samples = (length + 4) * spacing;
  const channels = Object.fromEntries([... 'ACGT'].map(b => [b, new Int16Array(samples).fill(1)]));
  const peakLocations = Array.from({ length }, (_, j) => (j + 2) * spacing);
  const scale = { A: 1, C: .85, G: .7, T: .95 };
  let calls = '';
  for (let j = 0; j < length; j++) {
    const comp = { A: 0, C: 0, G: 0, T: 0 };
    for (const a of alleles) comp[a.sequence[j]] += a.fraction;
    calls += Object.keys(comp).sort((a, b) => comp[b] - comp[a])[0];
    for (const b of 'ACGT') for (let d = -4; d <= 4; d++) channels[b][peakLocations[j] + d] += Math.round(1200 * scale[b] * comp[b] * Math.exp(-.5 * (d / 1.6) ** 2));
  }
  return { name: 'simulated.ab1', samples, calls, peakLocations, channels, quality: new Uint8Array(length).fill(60) };
}
export const traceOf = sequence => syntheticTrace([{ sequence, fraction: 1 }]);
