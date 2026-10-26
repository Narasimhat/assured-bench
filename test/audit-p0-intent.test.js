import test from "node:test";
import assert from "node:assert/strict";
import { parseBiomniPrompt, buildManualBiomniPrompt, runBiomniCoScientist, intentErrors, BIOMNI_PRESET_MISSIONS } from "../src/services/biomniAgent.js";

const read = (p, project = {}) => { const i = parseBiomniPrompt(p, project); return { gene: i.gene, editType: i.editType, mutation: i.mutation, ok: i.ok, errors: i.errors }; };

test("a cell type is not a gene: 'Knock out LRRK2 in iPSCs' targets LRRK2 (it was read as the gene IPSCS)", () => {
  for (const p of ["Knock out LRRK2 in iPSCs", "knock out LRRK2 in hiPSC-derived neurons", "Knock out LRRK2 in HEK293T cells", "KNOCK OUT LRRK2 IN IPSCS"]) {
    assert.deepEqual([read(p).gene, read(p).editType, read(p).ok], ["LRRK2", "ko", true], p);
  }
});

test("a request without a gene is an error, not TP53", () => {
  for (const p of ["Design a knockout", "Design a point mutation R175H knock-in", "Knock out lrrk2", ""]) {
    const r = read(p); assert.equal(r.ok, false, p); assert.equal(r.gene, "", p); assert.ok(r.errors.some((e) => /gene symbol/i.test(e)), p);
  }
});

test("the loaded project's gene is used only when the request says so, and the assumption is reported", () => {
  const project = { gene: "DIPK2A" };
  assert.equal(read("Design a knockout", project).ok, false);
  const i = parseBiomniPrompt("Knock out this gene", project); assert.equal(i.gene, "DIPK2A"); assert.ok(i.assumptions.some((a) => /loaded project/.test(a)));
  const lowercase = parseBiomniPrompt("knock out dipk2a", project); assert.equal(lowercase.gene, "DIPK2A"); assert.ok(lowercase.assumptions.some((a) => /read as the gene symbol/.test(a)));
  assert.equal(read("knock out lrrk2", project).ok, false, "a lower-case word that is neither the project's gene nor a listed gene is not read as a gene");
});

test("a point mutation needs its residue, an internal tag needs its position, a tag edit needs a tag: no R175H / R154 / FLAG defaults", () => {
  const pm = read("Make a point mutation in PINK1"); assert.equal(pm.ok, false); assert.equal(pm.mutation, ""); assert.ok(pm.errors.some((e) => /amino-acid change/.test(e)));
  assert.equal(read("Design a point mutation knock-in for SORCS1").ok, false);
  assert.ok(read("Design an internal SPOT tag for APOE").errors.some((e) => /position/.test(e)));
  assert.ok(parseBiomniPrompt("Design a C-terminal tag for APOE").errors.some((e) => /tag is not named/.test(e)));
  assert.ok(parseBiomniPrompt("Design an N-terminal tag for MAPT using Cas12a").errors.some((e) => /tag is not named/.test(e)));
  assert.deepEqual(read("Design an internal SPOT tag at R154 for APOE"), { gene: "APOE", editType: "it", mutation: "R154", ok: true, errors: [] });
});

test("an unstated edit type is an error, not a knockout", () => {
  for (const p of ["Check DIPK2A domains", "Design a knock-in for APOE"]) { const r = read(p); assert.equal(r.ok, false, p); assert.ok(r.errors.some((e) => /edit type/.test(e)), p); }
});

test("several gene symbols are reported as ambiguous, with one message", () => {
  const i = parseBiomniPrompt("Knock out TP53 and BRCA1"); assert.equal(i.ok, false); assert.equal(i.gene, ""); assert.equal(i.errors.length, 1); assert.match(i.errors[0], /TP53, BRCA1/);
});

test("residue-like gene symbols and tag names are not mistaken for each other", () => {
  assert.deepEqual(read("Design a knockout for A2M"), { gene: "A2M", editType: "ko", mutation: "", ok: true, errors: [] });
  assert.deepEqual(read("Design a point mutation in HEK293T cells for KRAS G12D"), { gene: "KRAS", editType: "pm", mutation: "G12D", ok: true, errors: [] });
  const t2a = parseBiomniPrompt("Design a C-terminal T2A-EGFP knock-in for LMNA with SpCas9-NG");
  assert.deepEqual([t2a.gene, t2a.editType, t2a.mutation, t2a.tag, t2a.enzyme, t2a.ok], ["LMNA", "ct", "", "T2A-EGFP", "spcas9ng", true]);
  assert.equal(read("Design a knockout for C3orf58").gene, "C3ORF58");
  const hit = read("Design R175H point mutation knock-in for TP53"); assert.deepEqual([hit.gene, hit.mutation, hit.editType], ["TP53", "R175H", "pm"]);
});

test("the enzyme default is reported as an assumption; a named enzyme is not", () => {
  assert.ok(parseBiomniPrompt("Knock out DIPK2A").assumptions.some((a) => /Enzyme not named/.test(a)));
  assert.equal(parseBiomniPrompt("Knock out DIPK2A with SpCas9").assumptions.length, 0);
});

test("every preset mission is understood without errors", () => {
  for (const m of BIOMNI_PRESET_MISSIONS) { const i = parseBiomniPrompt(m.prompt); assert.equal(i.ok, true, m.id); }
});

test("the manual-design prompt needs a gene and round-trips through the parser", () => {
  assert.throws(() => buildManualBiomniPrompt({ gene: "", editType: "ko" }), /gene symbol is required/);
  assert.throws(() => buildManualBiomniPrompt({ editType: "ko" }), /gene symbol is required/);
  for (const [args, want] of [[{ gene: "DIPK2A", editType: "ko" }, ["DIPK2A", "ko", ""]], [{ gene: "TP53", editType: "pm", mutation: "R175H" }, ["TP53", "pm", "R175H"]],
    [{ gene: "APOE", editType: "ct", tag: "FLAG" }, ["APOE", "ct", ""]], [{ gene: "APOE", editType: "it", tag: "SPOT", mutation: "R154" }, ["APOE", "it", "R154"]]]) {
    const i = parseBiomniPrompt(buildManualBiomniPrompt(args)); assert.deepEqual([i.gene, i.editType, i.mutation], want, JSON.stringify(args)); assert.ok(i.ok, JSON.stringify([args, i.errors]));
  }
});

test("running refuses an uninterpretable request before any network or design step", async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { ok: false, status: 500 }; };
  const geneFetcher = async () => { calls += 1; throw new Error("must not be reached"); };
  await assert.rejects(() => runBiomniCoScientist("Design a knockout", {}, { fetchFn, geneFetcher }), /not run.*gene symbol/i);
  await assert.rejects(() => runBiomniCoScientist("Make a point mutation in PINK1", {}, { fetchFn, geneFetcher }), /amino-acid change/);
  assert.equal(calls, 0);
  // an override that supplies the missing gene passes the check, so the run proceeds to the (stubbed) gene fetch
  const res = await runBiomniCoScientist("Design a knockout", {}, { fetchFn, geneFetcher, intentOverride: { gene: "DIPK2A", editType: "ko" } }).catch((e) => ({ thrown: e.message }));
  assert.ok(calls > 0, "the override reached the gene fetch"); assert.ok(!res.thrown || !/was not run/.test(res.thrown));
  assert.deepEqual(intentErrors({ gene: "X1", editType: "pm", mutation: "" }).length, 1);
});
