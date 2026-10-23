// Cut-site discovery from the traces alone, for samples with no guide on record: an indel starts where the edited trace stops matching the
// control. The estimate is the first position at which the discordance stays high; it is where the signal diverges, which is the cut for
// deletions and insertions and can lie a little downstream of it when the edit starts with bases that match the wild type (microhomology).
import { buildComposition } from "./traceModel.js";
import { localAlign } from "./align.js";
import { longestGoodRun } from "./prepare.js";

export function discordanceProfile(control, edited) {
  const c = buildComposition(control); const e = buildComposition(edited);
  const good = longestGoodRun(c.quality, 0, Math.floor(c.calls.length * 0.9), 30, 15);
  if (!good || good.end - good.start < 80) return { ok: false, error: "The control has no stretch of good quality long enough to compare against." };
  const piece = c.calls.slice(good.start, good.start + 60);
  const alignment = localAlign(e.calls, piece); const counts = new Map();
  alignment.readToRef.forEach((r, k) => { if (r >= 0) { const shift = k - (r + good.start); counts.set(shift, (counts.get(shift) || 0) + 1); } });
  let shift = 0; let top = -1; for (const [s, n] of counts) if (n > top) { top = n; shift = s; }
  if (top < 30) return { ok: false, error: "The edited trace does not line up with the control before the cut." };
  const d = new Float64Array(c.calls.length).fill(NaN);
  for (let j = 0; j < c.calls.length; j += 1) {
    const k = j + shift; if (k < 0 || k >= e.calls.length || !c.valid[j] || !e.valid[k]) continue;
    let sum = 0; for (let b = 0; b < 4; b += 1) sum += Math.abs(e.composition[k * 4 + b] - c.composition[j * 4 + b]); d[j] = sum / 2;
  }
  return { ok: true, d, good, shift };
}

/** @returns {{ ok: boolean, readIndex?: number, confidence?: number, error?: string }} readIndex is an index into the control read. */
export function discoverCut({ control, edited, threshold = 0.15 }) {
  const prof = discordanceProfile(control, edited); if (!prof.ok) return prof;
  const { d, good } = prof; const mean = (from, to) => { let s = 0; let n = 0; for (let j = from; j < to; j += 1) if (!Number.isNaN(d[j])) { s += d[j]; n += 1; } return n ? s / n : NaN; };
  for (let j = good.start + 30; j < good.end - 60; j += 1) {
    if (mean(j, j + 8) > threshold * 1.5 && mean(j, j + 60) > threshold) {
      // Refine: the change point that best splits the discordance into an upstream level and a downstream level.
      const mu0 = mean(good.start + 10, Math.max(good.start + 11, j - 20)); const mu1 = mean(j + 10, j + 60);
      let best = j; let bestCost = Infinity;
      for (let c = Math.max(good.start + 25, j - 20); c <= j + 20; c += 1) {
        let cost = 0; for (let p = Math.max(good.start + 10, c - 40); p < c + 40; p += 1) { if (Number.isNaN(d[p])) continue; const level = p < c ? mu0 : mu1; cost += (d[p] - level) ** 2; }
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      return { ok: true, readIndex: best, confidence: Math.min(1, mean(j, j + 60) / (threshold * 3)), downstreamDiscordance: mean(j, j + 60) };
    }
  }
  return { ok: false, error: "No position where the edited trace departs from the control was found: no edit, or an edit too small or too late in the read." };
}
