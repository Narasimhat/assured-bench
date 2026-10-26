// Lindel in JavaScript: the predicted frequency of every SpCas9 repair outcome at a cut site.
//
//   Chen W, McKenna A, Schreiber J, Haeussler M, Yin Y, Agarwal V, Noble WS, Shendure J. Massively parallel profiling and predictive modeling of the outcomes
//   of CRISPR/Cas9-induced double-strand breaks reveals common mutation patterns. Nucleic Acids Research 47:7989-8000 (2019). github.com/shendurelab/Lindel
//   Lindel is MIT licensed (Copyright (c) 2019 Wei Chen); the licence text is in LICENSE-Lindel.txt next to the weights this module reads.
//
// This is a line-by-line port of Lindel/Predictor.py (gen_indel, label_mh, create_feature_array, onehotencoder, gen_cmatrix, gen_prediction). The model is
// three multinomial logistic regressions: the share of deletions against insertions, which deletion, which insertion. Deletions are all those shorter than
// 30 bp that cross the cut; insertions are the 20 one- and two-base ones and one class for everything longer. Deletions that give the same sequence
// (microhomology) are merged into one class. tools/ko-rank/test and test/lindel.test.js check this port against the Python implementation.
//
// Input is a 65-nt window with the cut between index 29 and 30 and the guide at index 13..32 followed by its NGG PAM at 33..35, all on the guide's strand.
// A deletion `start+length` removes `length` bases starting `start` bases from the cut (negative = upstream); an insertion `n+BASES` inserts BASES at the cut.

const NT = ["A", "T", "C", "G"];
const CUT = 30;
const PAMS = new Set(["AGG", "TGG", "CGG", "GGG"]);

/** Reads the binary written by tools/ko-rank/export_lindel_weights.py (layout described there). */
export function parseLindelWeights(input) {
  const view = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error("Lindel weights are little-endian; this platform is not.");
  const bytes = new Uint8Array(view);
  if (String.fromCharCode(...bytes.slice(0, 8)) !== "LNDLJS01") throw new Error("Not a Lindel weights file (bad magic).");
  const headerLength = new DataView(view).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + headerLength)));
  if (header.format !== "lindel-js-1") throw new Error(`Unsupported Lindel weights format ${header.format}.`);
  const dataStart = 12 + headerLength;
  const t = {};
  for (const tensor of header.tensors) {
    const n = tensor.shape.reduce((a, b) => a * b, 1);
    if (tensor.bytes !== n * 4 || dataStart + tensor.offset + tensor.bytes > view.byteLength) throw new Error(`Lindel weights file is truncated or inconsistent at ${tensor.name}.`);
    t[tensor.name] = new Float32Array(view, dataStart + tensor.offset, n);
  }
  const label = new Map(header.classes.map((name, index) => [name, index]));
  const features = new Map(header.features.map((name, index) => [name, index]));
  const model = { header, w1: t.w1, b1: t.b1, w2: t.w2, b2: t.b2, w3: t.w3, b3: t.b3, classes: header.classes, label, features, frameShift: Float64Array.from(header.frameShift) };
  if (model.w1.length !== 384 * 2 || model.w2.length !== 3033 * 536 || model.w3.length !== 104 * 21 || label.size !== 557 || features.size !== 2649) throw new Error("Lindel weights have unexpected dimensions.");
  return model;
}

/** Every distinct deletion and short insertion at the cut, with microhomology labelled (gen_indel + label_mh). Map order is Python dict order on purpose. */
function genIndel(sequence) {
  const dmax = Math.min(CUT, sequence.length - CUT);
  const unique = new Map();
  for (let dstart = 1; dstart < CUT + 3; dstart += 1) {
    for (let dlen = 1; dlen < dmax; dlen += 1) {
      if (CUT - 2 < dstart + dlen && dstart + dlen < sequence.length) {
        const seq = sequence.slice(0, dstart) + sequence.slice(dstart + dlen);
        if (!unique.has(seq) || dstart - 30 < 1) unique.set(seq, { kind: "del", start: dstart - 30, len: dlen, mh: false, mhLen: 0 });
      }
    }
  }
  for (let length = 1; length < 3; length += 1) {
    const bases = length === 1 ? NT.map((a) => a) : NT.flatMap((a) => NT.map((b) => a + b));
    for (const b of bases) unique.set(sequence.slice(0, CUT) + b + sequence.slice(CUT), { kind: "ins", start: 0, len: length, bases: b, mh: false, mhLen: 0 });
  }
  const reads = [...unique.values()];
  for (const read of reads) {
    if (read.kind !== "del") continue;
    const idx = 13 + read.start + 17; const idx2 = idx + read.len;
    for (let i = Math.min(4, read.len); i > 0; i -= 1) {
      if (sequence.slice(idx - i, idx) === sequence.slice(idx2 - i, idx2) && i <= read.len) { read.mh = true; read.mhLen = i; break; }
    }
  }
  return reads;
}

/** Single- and di-nucleotide one-hot encoding as the indices of the 1s (onehotencoder). */
function oneHotIndices(seq) {
  const l = seq.length; const single = 4 * l; const out = [];
  for (let j = 0; j < l; j += 1) out.push(j * 4 + NT.indexOf(seq[j]));
  for (let k = 0; k < l - 1; k += 1) out.push(single + k * 16 + NT.indexOf(seq[k]) * 4 + NT.indexOf(seq[k + 1]));
  return out;
}

function softmaxOfLogits(logits) { const e = logits.map(Math.exp); let sum = 0; for (const v of e) sum += v; return e.map((v) => v / sum); }

/** logits = bias + sum of the weight rows whose input is 1 */
function sparseLogits(active, weights, bias, width) {
  const logits = Array.from(bias, (b) => b);
  for (const row of active) { const base = row * width; for (let j = 0; j < width; j += 1) logits[j] += weights[base + j]; }
  return logits;
}

/**
 * Predicted outcome frequencies for one 65-nt window. Returns { frequencies (557, summing to 1), frameshift, classes } or { error } when the window cannot be scored.
 * `classes[i]` names class i: "start+length" for a deletion, "n+BASES" for a 1-2 bp insertion, "3" for any longer insertion.
 */
export function predictLindel(model, window65) {
  const seq = String(window65 || "").toUpperCase();
  if (seq.length !== 65 || !/^[ACGT]+$/.test(seq)) return { error: "Lindel needs a 65-nt window of A, C, G and T." };
  if (!PAMS.has(seq.slice(33, 36))) return { error: "No NGG PAM at positions 34-36 of the window." };
  const guide = seq.slice(13, 33);
  const reads = genIndel(seq);
  const guideHot = oneHotIndices(guide);
  // create_feature_array sets a 0/1 feature, so a feature several reads share counts once
  const featureSet = new Set();
  for (const read of reads) {
    const at = model.features.get(`${read.start}+${read.len}+${read.mh ? read.mhLen : 0}`);
    if (at !== undefined) featureSet.add(at);
  }
  const delActive = [...featureSet, ...guideHot.map((i) => 2649 + i)];
  const [dratio, insratio] = softmaxOfLogits(sparseLogits(guideHot, model.w1, model.b1, 2));
  const ds = softmaxOfLogits(sparseLogits(delActive, model.w2, model.b2, 536));
  const ins = softmaxOfLogits(sparseLogits(oneHotIndices(guide.slice(-6)), model.w3, model.b3, 21));
  const y = [...ds.map((v) => v * dratio), ...ins.map((v) => v * insratio)];

  // gen_cmatrix: classes that give the same sequence by microhomology are merged into the first of them. The matrix is applied as y · M.
  const targets = Array.from({ length: 557 }, (_, i) => new Set([i]));
  for (const read of reads) {
    if (!read.mh) continue;
    const group = [];
    for (let i = 0; i <= read.mhLen; i += 1) { const at = model.label.get(`${read.start - i}+${read.len}`); if (at !== undefined) group.push(at); }
    if (group.length > 1) for (const i of group.slice(1)) { targets[i].add(group[0]); targets[i].delete(i); }
  }
  const frequencies = new Float64Array(557);
  for (let i = 0; i < 557; i += 1) for (const j of targets[i]) frequencies[j] += y[i];
  let frameshift = 0;
  for (let i = 0; i < 557; i += 1) frameshift += frequencies[i] * model.frameShift[i];
  return { frequencies, frameshift, classes: model.classes };
}

/** The outcome classes at or above `minFreq` as edits (the shape tools/ko-rank/lindel_outcomes.py writes). */
export function lindelEdits(prediction, minFreq = 2e-5) {
  const edits = [];
  prediction.frequencies.forEach((f, i) => {
    if (f < minFreq) return;
    const k = prediction.classes[i];
    if (!k.includes("+")) { edits.push({ k, f, kind: "ins_group" }); return; }
    const [start, tail] = k.split("+");
    if (/^[ACGT]+$/.test(tail)) edits.push({ k, f, kind: "ins", bases: tail });
    else edits.push({ k, f, kind: "del", start: Number(start), length: Number(tail) });
  });
  return edits;
}
