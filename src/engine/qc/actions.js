// What to do with each clone, in the lab's terms. A display layer over the engine's call: it reads the decision, the recommendation class, the confidence and the
// flags, and never changes a decision. "Sequence again" is one engine call that covers several different situations; here they are told apart.
import { flagsFor } from "./unwanted.js";

export const ACTIONS = [
  { key: "carry", label: "Carry forward", how: "Validate (out-out PCR, sequencing in both directions), then expand." },
  { key: "reserve", label: "Reserve", how: "Accepted but not in the panel: keep as a backup." },
  { key: "confirm", label: "Confirm a base", how: "Read the flagged position again from the other direction before using the clone." },
  { key: "repick", label: "Re-pick or subclone", how: "The trace is clear and shows a mixed or incompletely converted clone: reading it again will not change that." },
  { key: "repeat", label: "Repeat the read", how: "The trace is too noisy to settle the call: sequence the same PCR product again, or re-amplify." },
  { key: "fix", label: "Fix the input", how: "The read could not be compared with its control: check the control, the primer and the read direction." },
  { key: "hold", label: "Hold", how: "Decide by hand; the reason is given." },
  { key: "other", label: "Not the intended edit", how: "Carries an indel or another allele instead of the edit. An indel clone can serve as a knock-out control; otherwise drop it." },
  { key: "discard", label: "Discard", how: "Wild type, incomplete conversion, or an unwanted protein-changing base." },
];
export const ACTION = Object.fromEntries(ACTIONS.map((a, i) => [a.key, { ...a, order: i }]));
/** The actions whose clones deserve the full per-clone figures. */
export const FOCUS_ACTIONS = new Set(["carry", "reserve", "confirm", "repick", "hold"]);

const sentence = (text, max = 150) => { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).replace(/[ ,;:(]+\S*$/, "")}…` : t; };
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
const edit = (r) => r.summary?.intendedEditPct ?? r.summary?.koScorePct ?? r.summary?.functionalKoPct ?? null;

/** The unplanned bases of a clone as short phrases: "L188 change (C>T at -26), in 2 reads". */
export function unplannedPhrases(r) {
  return (r.unwanted?.changes || []).map((c) => {
    const what = c.consequence?.label || c.consequence?.class || "base change";
    const seen = c.confirmed ? `in ${c.readsSeen || 2} reads` : c.discordant ? "reads disagree" : "in one read only";
    return `${what} (${c.ref}>${c.alt} at ${signed(c.relative)}), ${seen}`;
  });
}

function rejectWhy(r) {
  const bases = unplannedPhrases(r);
  if (r.decision?.unwanted === "block" && bases.length) return `Unplanned protein-changing base: ${bases.slice(0, 2).join("; ")}${bases.length > 2 ? "; …" : ""}`;
  return sentence(r.genotype?.summary || (r.decision?.reasons || [])[0] || "Rejected");
}

/** The engine's genotype sentences are long; the table needs the short form. */
export function briefGenotype(text) {
  const t = String(text || "");
  if (/^Mixed or unclear/i.test(t)) return "Mixed or unclear (more than two alleles)";
  if (/^Homozygous wild type/i.test(t)) return "Wild type, no edit";
  if (/^Homozygous for a partial conversion/i.test(t)) return "Partial conversion: blocking changes without the edit";
  return t;
}

export function nextAction(workflow, r) {
  const call = r.decision?.decision || "";
  const priority = r.recommendation?.priority;
  const done = (key, why) => ({ key, why: sentence(why, 190), call });
  if (!r || r.ok === false) return done("fix", r?.error || "The sample could not be analysed.");
  if (r.kind === "junction") return done(call === "accept" ? "carry" : call === "reject" ? "discard" : call === "re-sequence" ? "repeat" : "hold", (r.decision?.reasons || [])[0] || r.verdict?.text || "");
  if (call === "reject") return done("discard", rejectWhy(r));
  if (priority === "discard") return done("discard", rejectWhy(r));
  if (priority === "caution") return done("hold", (r.decision?.reasons || [])[0] || r.recommendation?.why);
  if (priority === "reserve" || priority === "duplicate") return done("reserve", r.recommendation?.why || r.genotype?.summary);
  if (priority === "first" || priority === "confirmed" || call === "accept") {
    const careful = call !== "accept" && /after checking/i.test(r.recommendation?.action || "");
    return done("carry", [r.genotype?.summary, careful && "Usable, but not the cleanest: check the flagged points first."].filter(Boolean).join(". "));
  }
  if (priority === "not_recommended") return done("other", r.genotype?.summary || r.recommendation?.why);
  if (call === "re-sequence" || priority === "resequence") {
    const [lo, hi] = r.intervals?.editedPct || [];
    const flags = flagsFor(r, workflow);
    const e = edit(r);
    if (r.genotype?.mixedClone && r.confidence?.tier !== "low") return done("repick", r.genotype.summary);
    const carriesEdit = e !== null && e >= 50 && (lo === undefined || lo >= 50);
    if (carriesEdit && flags.some((f) => f.code === "unplanned-base" && f.severity !== "info")) return done("confirm", unplannedPhrases(r).join("; ") || "An unplanned base was seen.");
    if (r.confidence?.tier === "low") return done("repeat", `The 95% interval for the edited share is ${lo ?? "?"}-${hi ?? "?"}%: too wide to call.${r.genotype?.mixedClone ? " At a one-copy locus two alleles mean a mixed clone: if the repeat still shows them, re-pick." : ""}`);
    if (e !== null && e < 20) return done("other", r.genotype?.summary);
    return done("repick", r.genotype?.summary || (r.decision?.reasons || [])[0]);
  }
  return done("hold", (r.decision?.reasons || [])[0] || r.recommendation?.why);
}

// "PHF6_S199E_Cl_12_1174_EF74878458" and "PHF6_S199E_Cl_12_1175_EF74878487" are two reads of clone 12; "cl12" is what the table shows.
const CLONE_NAME = /(?:^|[^A-Za-z])(?:cl|clone|clon)[_\-\s]?0*(\d+)(?!\d)/i;
export function cloneLabel(name) { const m = CLONE_NAME.exec(String(name)); return m ? `cl${m[1]}` : null; }

/**
 * One row per clone. A read that could not be analysed is folded into the row of the same clone when another read of it was; clones whose names carry no
 * clone number keep their own names and rows.
 */
export function actionRows(workflow, results) {
  const items = (results || []).filter(Boolean).map((r) => ({ r, label: cloneLabel(r.name) }));
  const named = items.every((x) => x.label);
  const groups = new Map();
  items.forEach((x) => {
    const key = named ? x.label : x.r.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x.r);
  });
  const rows = [];
  for (const [key, members] of groups) {
    const good = members.filter((m) => m.ok !== false);
    const primary = good[0] || members[0];
    const folded = good.length ? members.filter((m) => m.ok === false) : [];
    const extra = good.slice(1);
    rows.push({ label: key, name: primary.name, result: primary, folded, ...nextAction(workflow, primary) });
    extra.forEach((m) => rows.push({ label: m.name, name: m.name, result: m, folded: [], ...nextAction(workflow, m) }));
  }
  const labelOf = new Map(); rows.forEach((row) => { labelOf.set(row.name, row.label); row.folded.forEach((f) => labelOf.set(f.name, row.label)); });
  rows.sort((a, b) => ACTION[a.key].order - ACTION[b.key].order || (a.result.recommendation?.rank ?? 1e9) - (b.result.recommendation?.rank ?? 1e9));
  const counts = Object.fromEntries(ACTIONS.map((a) => [a.key, rows.filter((row) => row.key === a.key).length]));
  return { rows, counts, labelOf, named };
}
