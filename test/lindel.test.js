import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseGB } from "../src/engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../src/engine/design/transcriptModel.js";
import { parseLindelWeights, predictLindel, lindelEdits } from "../src/engine/design/lindel/lindel.js";
import { loadLindel, LINDEL_WEIGHTS_URL } from "../src/engine/design/lindel/loadLindel.js";
import { rankKoGuides, createKoOutcomeScorer, listKoCandidates, toCsv } from "../src/engine/design/koRank.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(HERE, "fixtures", name);
const weightsFile = fileURLToPath(LINDEL_WEIGHTS_URL);
const model = normalizeGenBankToTranscriptModel(parseGB(fs.readFileSync(fixture("dipk2a-region.gb"), "utf8")), {});
const parity = JSON.parse(fs.readFileSync(fixture("lindel-parity.json"), "utf8"));
const lindel = parseLindelWeights(fs.readFileSync(weightsFile));

test("the weights file is the one exported from Lindel's pickles: pinned hash, provenance in the header, licence next to it", () => {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(weightsFile)).digest("hex");
  assert.equal(sha, "2acfcf2c30d8bdae1022b69123255418200ef9429452ebe741f81f64eb4278ea", "regenerate with tools/ko-rank/export_lindel_weights.py and update this hash on purpose");
  assert.equal(lindel.header.source, "github.com/shendurelab/Lindel");
  assert.match(lindel.header.paper, /Nucleic Acids Research 47:7989/);
  assert.match(fs.readFileSync(path.join(HERE, "..", "src", "engine", "design", "lindel", "LICENSE-Lindel.txt"), "utf8"), /MIT License[\s\S]*Wei Chen/);
  assert.equal(lindel.classes.length, 557); assert.equal(lindel.features.size, 2649);
});

test("JavaScript Lindel reproduces the Python implementation: every class frequency and the frame-shift ratio, including repeat, homopolymer and window-edge stress cases", () => {
  assert.ok(parity.windows.length >= 10);
  for (const w of parity.windows) {
    const p = predictLindel(lindel, w.window65);
    assert.ok(!p.error, w.label);
    let worst = 0; for (let i = 0; i < 557; i += 1) worst = Math.max(worst, Math.abs(p.frequencies[i] - w.frequencies[i]));
    assert.ok(worst < 1e-10, `${w.label}: max |difference| ${worst}`);
    assert.ok(Math.abs(p.frameshift - w.frameshift) < 1e-10, `${w.label} frame-shift`);
  }
});

test("predictions are probability distributions, and merged microhomology classes carry no frequency", () => {
  const p = predictLindel(lindel, parity.windows[0].window65);
  const sum = p.frequencies.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, String(sum));
  assert.ok(p.frequencies.every((f) => f >= 0));
  assert.ok(p.frequencies.filter((f) => f === 0).length > 50, "classes merged into a microhomology partner are zero");
  assert.ok(p.frameshift > 0 && p.frameshift < 1);
  const edits = lindelEdits(p); assert.ok(edits.some((e) => e.kind === "del") && edits.some((e) => e.kind === "ins") && edits.some((e) => e.kind === "ins_group"));
});

test("a window Lindel cannot score is refused with a reason, never guessed", () => {
  assert.match(predictLindel(lindel, "ACGT").error, /65-nt/);
  const noPam = parity.windows[0].window65.slice(0, 33) + "ATA" + parity.windows[0].window65.slice(36);
  assert.match(predictLindel(lindel, noPam).error, /PAM/);
  assert.match(predictLindel(lindel, parity.windows[0].window65.slice(0, 10) + "N" + parity.windows[0].window65.slice(11)).error, /65-nt/);
});

test("a damaged weights file is rejected", () => {
  const bytes = fs.readFileSync(weightsFile);
  assert.throws(() => parseLindelWeights(bytes.subarray(0, 100000)), /truncated|inconsistent/);
  const bad = Buffer.from(bytes); bad[0] = 0x58; assert.throws(() => parseLindelWeights(bad), /bad magic/);
});

test("loader: reads the asset once under Node and caches it; a failed fetch is not cached", async () => {
  const a = await loadLindel(); const b = await loadLindel(); assert.equal(a, b);
  let calls = 0;
  const failing = async () => { calls += 1; return { ok: false, status: 404 }; };
  await assert.rejects(loadLindel({ reload: true, url: new URL("https://example.invalid/w.bin"), fetchImpl: failing }), /HTTP 404/);
  const bytes = fs.readFileSync(weightsFile);
  const working = async () => { calls += 1; return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; };
  const c = await loadLindel({ url: new URL("https://example.invalid/w.bin"), fetchImpl: working });
  assert.equal(calls, 2); assert.equal(c.classes.length, 557);
  await loadLindel({ reload: true });
});

test("ranking in JavaScript equals the validated Python pipeline for all 145 DIPK2A candidates (same guides, same order, every column)", () => {
  const golden = fs.readFileSync(fixture("ko-rank-dipk2a-ranking.csv"), "utf8");
  const rows = rankKoGuides(model, lindel);
  assert.equal(rows.length, 145);
  assert.equal(toCsv(rows), golden.replace(/\r\n/g, "\n"));
});

test("scorer: the engine's guide objects get the same numbers as the ranking, on both strands, and an unscorable guide gives null", () => {
  const score = createKoOutcomeScorer(model, lindel);
  const rows = Object.fromEntries(rankKoGuides(model, lindel).map((r) => [r.spacer, r]));
  const G2 = "AGTTGGTCCTAGAGATGGGA"; const G1 = "TGTCAAAGCTGACGTCCAGG"; const EARLY = "TTTCCATTAATTGCCAAGCG";
  const candidates = listKoCandidates(model); const strands = new Set();
  for (const sp of [G2, G1, EARLY]) {
    const c = candidates.find((g) => g.spacer === sp); strands.add(c.strand);
    const guide = { sp, str: c.strand, cut: c.cut }; const s = score(guide);
    assert.equal(s.lofPct, rows[sp].predicted_LoF_allele_pct, sp); assert.equal(s.biallelicPct, rows[sp].predicted_biallelic_LoF_clone_pct); assert.equal(s.plus1Pct, rows[sp].lindel_plus1_ins_pct);
    assert.equal(s, score(guide), "cached");
  }
  assert.deepEqual([...strands].sort(), ["+", "-"], "both strands are covered");
  assert.equal(score({ sp: "ACGTACGTACGTACGTACGT", str: "+", cut: 40 }), null, "too close to the end of the sequence");
  assert.equal(score({ sp: "ACGTACGTACGTACGTACGT", str: "+", cut: 5000 }), null, "spacer does not match the record");
  assert.ok(rows[G2].predicted_LoF_allele_pct < 40 && rows[EARLY].predicted_LoF_allele_pct > 89);
});
