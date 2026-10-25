// The common Cas9-style SNP donor policy. Coordinates are input-reference interbase boundaries.
export const SNP_DONOR_POLICY = Object.freeze({ version: '1', length: 127, shortArm: 36, longArm: 91 });
export function snpDonorWindow(sequenceLength, cut, strand) {
  const { length, shortArm, longArm } = SNP_DONOR_POLICY;
  if (!Number.isInteger(cut) || !['+', '-'].includes(strand) || sequenceLength < length || cut < 0 || cut > sequenceLength) return null;
  let start = cut - (strand === '+' ? shortArm : longArm), end = start + length;
  if (start < 0) { end -= start; start = 0; }
  if (end > sequenceLength) { start -= end - sequenceLength; end = sequenceLength; }
  return start < 0 || end - start !== length ? null : { start, end };
}
export const snpDonorStrand = strand => strand === '+' ? 'antisense' : 'sense';
