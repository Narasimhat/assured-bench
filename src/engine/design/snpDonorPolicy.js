// PAM-oriented SNP donor policy: the long flank faces the PAM. Coordinates are input-reference interbase boundaries.
export const SNP_DONOR_POLICY = Object.freeze({ version: '2', length: 127, shortArm: 36, longArm: 91, longSide: 'PAM-proximal', anchor: 'nominal target-strand cut' });
export function snpDonorArms(strand, pamSide = '3prime') {
  if (!['+', '-'].includes(strand) || !['3prime', '5prime'].includes(pamSide)) return null;
  const longUpstream = (pamSide === '5prime') === (strand === '+');
  const upstream = longUpstream ? SNP_DONOR_POLICY.longArm : SNP_DONOR_POLICY.shortArm;
  return { upstream, downstream: SNP_DONOR_POLICY.length - upstream };
}
export function snpDonorWindow(sequenceLength, cut, strand, pamSide = '3prime') {
  const { length } = SNP_DONOR_POLICY;
  if (!Number.isInteger(cut) || !['+', '-'].includes(strand) || !['3prime', '5prime'].includes(pamSide) || sequenceLength < length || cut < 0 || cut > sequenceLength) return null;
  const arms = snpDonorArms(strand, pamSide);
  let start = cut - arms.upstream, end = start + length;
  if (start < 0) { end -= start; start = 0; }
  if (end > sequenceLength) { start -= end - sequenceLength; end = sequenceLength; }
  return start < 0 || end - start !== length ? null : { start, end };
}
export const snpDonorStrand = strand => strand === '+' ? 'antisense' : 'sense';
