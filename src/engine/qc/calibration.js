// Calibration of the functional knockout call against protein (and transcript) measurements.
//
// Input: the results of a run with a gene record (results.json: one entry per clone with `name`, `functional.call.status` and the allele rows) and a table of what was
// measured for each clone. Output: how often each call was borne out, with Wilson intervals, and which allele classes (NMD, truncation, splice site) the failures come from.
// Nothing here changes a call; it only reports. With fewer than about 20 clones the intervals are wide, and the report says so.

export const PROTEIN_WORDS = {
  absent: ["absent", "none", "no", "negative", "neg", "0", "lost", "ko", "-"],
  reduced: ["reduced", "low", "partial", "weak", "decreased"],
  present: ["present", "wt", "normal", "yes", "positive", "pos", "+", "full-length", "full length"],
  truncated: ["truncated", "smaller", "shorter", "lower band", "truncation"],
};
export const RNA_WORDS = { decayed: ["decayed", "reduced", "low", "decay", "nmd", "down", "lost"], stable: ["stable", "normal", "unchanged", "present", "wt", "no decay", "no change"] };

export const normalise = (value, table) => {
  const text = String(value ?? "").trim().toLowerCase(); if (!text) return null;
  for (const [key, words] of Object.entries(table)) if (words.includes(text)) return key;
  return "unrecognised";
};

/** Wilson score interval for k of n (95% by default). */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null };
  const p = k / n; const d = 1 + (z * z) / n; const centre = (p + (z * z) / (2 * n)) / d; const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Comma- or tab-separated text with a header row (quotes allowed) into objects with lower-case keys. */
export function parseObservations(text) {
  const lines = String(text).replace(/\r/g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return { rows: [], errors: ["The observations file is empty."] };
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const split = (line) => { const out = []; let cur = ""; let quoted = false; for (const ch of line) { if (ch === "\"") quoted = !quoted; else if (ch === delimiter && !quoted) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const header = split(lines[0]).map((h) => h.toLowerCase()); const errors = [];
  if (!header.includes("sample")) errors.push("The observations need a 'sample' column (the sample name used in the run) and a 'protein' column.");
  if (!header.includes("protein")) errors.push("The observations need a 'protein' column: absent, reduced, present or truncated.");
  const rows = lines.slice(1).map((l) => { const cells = split(l); const row = {}; header.forEach((h, i) => { row[h] = cells[i] ?? ""; }); return row; });
  return { rows, errors };
}

const dominant = (result) => { const rows = (result.functional && result.functional.rows) || []; return rows.filter((r) => r.class !== "wt").sort((a, b) => b.fraction - a.fraction)[0] || null; };
const KNOCKOUT_CALLS = ["predicted_knockout", "predicted_knockout_with_caveats"];

/**
 * @param {Array} results run results (each with name and functional)
 * @param {Array<{sample: string, protein: string, rna?: string}>} observations
 */
export function calibrate(results, observations) {
  const byName = new Map(results.map((r) => [r.name, r])); const problems = []; const matched = [];
  observations.forEach((o) => {
    const name = String(o.sample || "").trim(); const r = byName.get(name) || results.find((x) => x.name && (x.name.startsWith(name) || name.startsWith(x.name)));
    if (!r) { problems.push(`${name}: not in the run results.`); return; }
    if (!r.functional) { problems.push(`${name}: the run has no functional call for it (no gene record, or the analysis failed).`); return; }
    const protein = normalise(o.protein, PROTEIN_WORDS);
    if (protein === null) { problems.push(`${name}: no protein result.`); return; }
    if (protein === "unrecognised") { problems.push(`${name}: protein result "${o.protein}" is not absent, reduced, present or truncated.`); return; }
    const top = dominant(r);
    matched.push({ name, status: r.functional.call.status, protein, rna: normalise(o.rna, RNA_WORDS), topClass: top ? top.class : "none", topLof: top ? top.lof : null, functionalKoPct: r.summary ? r.summary.functionalKoPct : null });
  });
  const statuses = [...new Set(matched.map((m) => m.status))].sort();
  const byStatus = statuses.map((s) => { const rows = matched.filter((m) => m.status === s); const count = (p) => rows.filter((m) => m.protein === p).length; return { status: s, n: rows.length, absent: count("absent"), reduced: count("reduced"), truncated: count("truncated"), present: count("present"), absentRate: wilson(count("absent"), rows.length) }; });
  const called = matched.filter((m) => KNOCKOUT_CALLS.includes(m.status)); const notCalled = matched.filter((m) => !KNOCKOUT_CALLS.includes(m.status));
  const tp = called.filter((m) => m.protein === "absent").length; const fn = notCalled.filter((m) => m.protein === "absent").length;
  const fp = called.length - tp; const tn = notCalled.length - fn;
  const classes = [...new Set(matched.map((m) => m.topClass))].sort();
  const byClass = classes.map((c) => { const rows = matched.filter((m) => m.topClass === c); const absent = rows.filter((m) => m.protein === "absent").length; return { class: c, n: rows.length, absent, absentRate: wilson(absent, rows.length) }; });
  const nmd = matched.filter((m) => m.topClass === "lof_nmd" && m.rna); const nmdDecayed = nmd.filter((m) => m.rna === "decayed").length;
  return {
    n: matched.length, problems, byStatus, byClass, matched,
    knockoutCall: { called: called.length, confirmed: tp, notConfirmed: fp, precision: wilson(tp, called.length), notCalled: notCalled.length, missed: fn, sensitivity: wilson(tp, tp + fn), specificity: wilson(tn, tn + fp) },
    nmd: { withRna: nmd.length, decayed: nmdDecayed, rate: wilson(nmdDecayed, nmd.length) },
    note: matched.length < 20 ? `Only ${matched.length} clones with a protein result: the intervals are wide, and a rule can look right or wrong by chance. About 20 or more are needed before a threshold is changed.` : "",
  };
}

const pc = (x) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(0)}%`);
const iv = (w) => (w.p === null ? "n/a" : `${pc(w.p)} (95% interval ${pc(w.lo)}-${pc(w.hi)})`);

export function calibrationMarkdown(result) {
  const k = result.knockoutCall; const out = ["# Calibration of the functional knockout call", "", `${result.n} clones with a protein result.${result.note ? ` ${result.note}` : ""}`, ""];
  out.push("## Call against protein", "", "| Call | Clones | Protein absent | Reduced | Truncated | Present | Share absent |", "|---|---|---|---|---|---|---|");
  result.byStatus.forEach((s) => out.push(`| ${s.status} | ${s.n} | ${s.absent} | ${s.reduced} | ${s.truncated} | ${s.present} | ${iv(s.absentRate)} |`));
  out.push("", `Predicted knockouts (with or without caveats): ${k.called}; protein absent in ${k.confirmed} (${iv(k.precision)}). Other calls: ${k.notCalled}; protein absent in ${k.missed} of them (missed knockouts). Sensitivity ${iv(k.sensitivity)}; specificity ${iv(k.specificity)}.`);
  out.push("", "## By the most abundant allele class", "", "| Class | Clones | Protein absent | Share absent |", "|---|---|---|---|");
  result.byClass.forEach((c) => out.push(`| ${c.class} | ${c.n} | ${c.absent} | ${iv(c.absentRate)} |`));
  if (result.nmd.withRna) out.push("", `Transcript: of ${result.nmd.withRna} clones whose main allele is predicted to trigger NMD and have an RNA result, the transcript fell in ${result.nmd.decayed} (${iv(result.nmd.rate)}).`);
  if (result.problems.length) out.push("", "## Not matched", "", ...result.problems.map((p) => `- ${p}`));
  return out.join("\n") + "\n";
}
