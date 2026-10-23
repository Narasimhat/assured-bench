// Small sequence helpers shared by the QC modules.
const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", N: "N" };

export function reverseComplement(sequence) {
  return [...String(sequence).toUpperCase()].reverse().map((base) => COMPLEMENT[base] || "N").join("");
}

export function cleanDna(sequence) {
  return String(sequence || "").toUpperCase().replace(/U/g, "T").replace(/[^ACGTN]/g, "");
}

export function isDna(sequence) {
  return /^[ACGT]+$/.test(String(sequence || ""));
}

export function hammingDistance(a, b) {
  let count = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) if (a[i] !== b[i]) count += 1;
  return count + Math.abs(a.length - b.length);
}
