// Non-negative least squares by the Lawson-Hanson active-set method, working on the Gram matrix so that
// hundreds of candidate alleles over a ~200-base window stay fast.

function choleskySolve(matrix, rhs, size) {
  // matrix: array of arrays (size x size), symmetric positive definite after ridge
  const L = Array.from({ length: size }, () => new Float64Array(size));
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= L[i][k] * L[j][k];
      if (i === j) { if (sum <= 1e-12) sum = 1e-12; L[i][i] = Math.sqrt(sum); } else L[i][j] = sum / L[j][j];
    }
  }
  const y = new Float64Array(size);
  for (let i = 0; i < size; i += 1) { let sum = rhs[i]; for (let k = 0; k < i; k += 1) sum -= L[i][k] * y[k]; y[i] = sum / L[i][i]; }
  const x = new Float64Array(size);
  for (let i = size - 1; i >= 0; i -= 1) { let sum = y[i]; for (let k = i + 1; k < size; k += 1) sum -= L[k][i] * x[k]; x[i] = sum / L[i][i]; }
  return x;
}

/**
 * Minimise ||A w - b||^2 subject to w >= 0, given AtA (n x n, Float64Array rows) and Atb (n).
 * @returns {Float64Array} w
 */
export function nnlsGram(AtA, Atb, { tolerance = 1e-9, maxIterations = null } = {}) {
  const n = Atb.length;
  const w = new Float64Array(n);
  const passive = [];
  const inPassive = new Uint8Array(n);
  const limit = maxIterations ?? Math.max(60, 3 * n);
  const gradient = () => {
    const g = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      let sum = Atb[i];
      const row = AtA[i];
      for (const k of passive) sum -= row[k] * w[k];
      g[i] = sum;
    }
    return g;
  };
  const solvePassive = () => {
    const size = passive.length;
    const matrix = passive.map((i) => passive.map((k) => AtA[i][k] + (i === k ? 1e-10 : 0)));
    const rhs = passive.map((i) => Atb[i]);
    return choleskySolve(matrix, rhs, size);
  };
  for (let iteration = 0; iteration < limit; iteration += 1) {
    const g = gradient();
    let best = -1; let bestValue = tolerance;
    for (let i = 0; i < n; i += 1) if (!inPassive[i] && g[i] > bestValue) { best = i; bestValue = g[i]; }
    if (best < 0) break;
    passive.push(best); inPassive[best] = 1;
    for (let inner = 0; inner < limit; inner += 1) {
      const s = solvePassive();
      let negative = false;
      for (let idx = 0; idx < passive.length; idx += 1) if (s[idx] <= tolerance) { negative = true; break; }
      if (!negative) { passive.forEach((i, idx) => { w[i] = s[idx]; }); break; }
      let alpha = Infinity;
      passive.forEach((i, idx) => { if (s[idx] <= tolerance) { const step = w[i] / (w[i] - s[idx]); if (step < alpha) alpha = step; } });
      if (!Number.isFinite(alpha)) alpha = 0;
      passive.forEach((i, idx) => { w[i] += alpha * (s[idx] - w[i]); });
      for (let idx = passive.length - 1; idx >= 0; idx -= 1) {
        const i = passive[idx];
        if (w[i] <= tolerance) { w[i] = 0; inPassive[i] = 0; passive.splice(idx, 1); }
      }
      if (!passive.length) break;
    }
  }
  return w;
}
