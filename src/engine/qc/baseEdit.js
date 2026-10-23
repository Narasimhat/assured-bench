// Base editing: A>G (ABE) or C>T (CBE) conversions inside the editing window of the protospacer (positions counted from the PAM-distal end).
// A trace gives the conversion at each position (the share of the new base, net of the control's background at that position), not which
// positions were converted together on the same allele, so the result is a per-position table, as in EditR; the indel library around the
// nick site is still fitted for the (rare) indels.
import { locateGuide } from "./nucleases.js";
import { shiftAt } from "./offset.js";

export const EDITORS = { ABE: { from: "A", to: "G", label: "Adenine base editor (A>G)" }, CBE: { from: "C", to: "T", label: "Cytosine base editor (C>T)" } };
export const DEFAULT_WINDOW = [4, 8];
const COMP = { A: "T", C: "G", G: "C", T: "A" };

export function baseEditMarkers({ reference, guide, editor = "ABE", window = DEFAULT_WINDOW, target = null, nuclease = "SpCas9" }) {
  const located = locateGuide(reference, guide, nuclease); if (located.error) return { error: located.error };
  const e = EDITORS[editor]; if (!e) return { error: `Unknown base editor ${editor}.` };
  const markers = [];
  for (let p = window[0]; p <= window[1]; p += 1) {
    const idx = located.strand === "+" ? located.start + p - 1 : located.end - p;
    if (idx < 0 || idx >= reference.length) continue;
    const refBase = reference[idx]; const guideBase = located.strand === "+" ? refBase : COMP[refBase];
    if (guideBase !== e.from) continue;
    const alt = located.strand === "+" ? e.to : COMP[e.to];
    markers.push({ pos: idx, ref: refBase, alt, role: target === p ? "intended" : "bystander", label: `protospacer position ${p}, ${e.from}>${e.to}`, protospacerPosition: p, change: `${refBase}>${alt}`, guide: null });
  }
  return { located, markers };
}

const BASE_INDEX = { A: 0, C: 1, G: 2, T: 3 };
const median = (values) => { if (!values.length) return NaN; const v = [...values].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

/**
 * Per-position conversion. The naive readout is the share of the new base net of the control's background at that position. Peak heights depend on
 * the sequence context, so the same conversion gives a taller or shorter new-base peak than the old base's: the share is corrected with the
 * expected height of the new base's peak in this neighbourhood of the control (median of its peaks within 30 bases) against the old base's actual
 * peak in the control, f = r Hc / (Hn + r Hc) with r the ratio of new to old peak in the edited trace; the correction is applied at 75% weight as a compromise:
 * on simulated traces built from real controls full weight gave a slightly lower mean error (3.4-3.5 points, 3.7 at 75%, 6.4 uncorrected), but full weight
 * was worse on an idealised fixture whose peak heights vary at random, which the correction cannot know. The interval half-width (8 points + 12% of the
 * conversion) covered 98% of the simulated positions it was set on (no held-out split). Not yet checked against real base-edited samples.
 */
export function baseEditTable(prepared, markerReadout, noiseRms = 0, options = {}) {
  const { control, edited, shift, readToRef } = prepared;
  const refToRead = new Map(); readToRef.forEach((r, j) => { if (r >= 0) refToRead.set(r, j); });
  return markerReadout.map((row) => {
    const base = { position: row.marker.pos, protospacerPosition: row.marker.protospacerPosition, change: row.marker.change, role: row.marker.role };
    if (!row.covered) return { ...base, covered: false, reason: row.reason };
    const naive = Math.max(0, row.altNet) * 100; let conversion = naive; let corrected = false;
    if (options.heightCorrection !== false) {
      const j = row.readIndex; const k = j + shiftAt(prepared, j); const alt = BASE_INDEX[row.marker.alt]; const ref = BASE_INDEX[row.marker.ref];
      const expected = [];
      const span = options.span ?? 30;
      for (let m = Math.max(0, j - span); m <= Math.min(control.calls.length - 1, j + span); m += 1) if (m !== j && control.calls[m] === row.marker.alt && control.quality[m] >= 30 && control.valid[m]) expected.push(control.composition[m * 4 + alt] * control.total[m]);
      const refPeak = control.composition[j * 4 + ref] * control.total[j]; const altPeak = Math.max(0, row.altNet) * edited.total[k]; const refEdited = edited.composition[k * 4 + ref] * edited.total[k];
      const hn = median(expected);
      if (expected.length >= (options.minPeaks ?? 3) && hn > 0 && refPeak > 0 && refEdited > 0 && altPeak >= 0) {
        const r = altPeak / refEdited; const full = (100 * r * refPeak) / (hn + r * refPeak); conversion = naive + (options.weight ?? 0.75) * (full - naive); corrected = true;
      }
    }
    const half = (options.margin ?? 8) + (options.slope ?? 0.12) * conversion;
    return { ...base, covered: true, conversionPct: Math.round(conversion * 10) / 10, naivePct: Math.round(naive * 10) / 10, heightCorrected: corrected, intervalPct: [Math.max(0, Math.round((conversion - half) * 10) / 10), Math.min(100, Math.round((conversion + half) * 10) / 10)] };
  });
}
