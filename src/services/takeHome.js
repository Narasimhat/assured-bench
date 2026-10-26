// The take-home message of a design: what was designed, what to expect, what to watch, what to do next. One short structure, built from the
// design result and the Co-Scientist report, shown at the top of the Design screen and at the top of the report. Everything here is already computed
// elsewhere; this only selects and phrases it, in plain words, and says what is not checked.
import { exonLabel } from "./exonLabels.js";

const TYPE_NAME = { ko: "knockout", pm: "point mutation", it: "internal tag", ct: "C-terminal tag", nt: "N-terminal tag", "genomic-snv": "genomic SNV" };
const TONE_RANK = { bad: 0, warn: 1, info: 2 };
const clip = (text, n = 150) => { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}\u2026` : t; };
const pct = (x) => (Number.isFinite(x) ? `${x}%` : null);
const list = (items, max = 3) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

function statusOf(result) {
  const status = result?.procurement?.status || "review";
  if (status === "blocked") return { tone: "bad", label: "Blocked: fix before ordering" };
  if (status === "ready") return { tone: "ok", label: "Ready to order" };
  return { tone: "warn", label: "Review before ordering" };
}

// the guides that cut a common variant, from the dbSNP screen (frequency 1% or more; only what the screen found)
function commonVariantFlag(screen, guides) {
  if (!screen) return null;
  if (screen.ok === false || screen.status === "not_assessed") return { tone: "info", key: "variants", text: "Known variants under the guides were not checked (dbSNP did not answer). Your line's own variants are never checked here." };
  const hits = [];
  for (const check of screen.guideChecks || []) for (const v of check.variants || []) if (v.class === "common") hits.push({ guide: check.label, rsid: v.rsid, maf: v.maf, allele: v.allele, where: v.location?.label || "" });
  if (!hits.length) return null;
  const h = hits[0]; const name = (guides.find((g) => g.n === h.guide || g.name === h.guide)?.short) || h.guide;
  return { tone: "warn", key: "variants", short: `${h.rsid} sits in ${name}'s ${/PAM/i.test(h.where) ? "PAM-adjacent base" : "target"}`, text: `${h.rsid} is at ${name}'s ${h.where || "target"}${h.allele && Number.isFinite(h.maf) ? ` (${h.allele} allele ${Math.round(h.maf * 1000) / 10}%)` : ""}: check your line's genotype.${hits.length > 1 ? ` ${hits.length - 1} more in the report.` : ""}` };
}

function isoformFlag(result, cutCoverage) {
  const gaps = result?.koAssessment?.isoformGaps || [];
  const outside = [];
  for (const g of cutCoverage?.ok ? cutCoverage.guides || [] : []) for (const c of [g.refseq, g.ensembl]) for (const name of c?.missing || []) if (!outside.includes(name)) outside.push(name);
  if (!gaps.length && !outside.length) return null;
  const parts = [];
  if (gaps.length) parts.push(`${list(gaps)} may still make protein`);
  if (outside.length) parts.push(`the cut is outside ${list(outside)}`);
  return { tone: "warn", key: "isoforms", short: `${list(gaps.length ? gaps : outside, 2)} may still make protein`, text: `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) };
}

// DepMap gene effect (Chronos): 0 = no effect, -1 = about the median of common-essential genes, positive = cells grow faster without the gene.
// The cut-offs below are choices for what is worth a line on the screen, not DepMap definitions: essential in most lines (median at or below -0.5),
// essential in a tenth of the screens or more, or a median gain of 0.2 or more.
function constraintFlag(viability) {
  if (!viability) return null;
  if (!viability.ok) return { tone: "info", key: "constraint", text: "Gene constraint and essentiality could not be retrieved." };
  const g = viability.gnomad; const d = viability.depmap;
  const constrained = g && (g.pLI >= 0.9 || g.loeuf < 0.6);
  const share = d && d.screens ? d.screensAtOrBelowCutoff / d.screens : 0;
  const essential = d && (d.medianGeneEffect <= -0.5 || share >= 0.1);
  const advantage = d && d.medianGeneEffect >= 0.2;
  if (!constrained && !essential && !advantage) return null;
  const parts = [];
  if (constrained) parts.push(`Constrained gene (pLI ${g.pLI}, LOEUF ${g.loeuf})`);
  if (essential) parts.push(d.medianGeneEffect <= -0.5 ? `essential in most cancer cell lines (DepMap median ${d.medianGeneEffect})` : `essential in ${Math.round(share * 100)}% of DepMap screens`);
  if (advantage) parts.push(`DepMap suggests cells grow faster without it (+${d.medianGeneEffect})`);
  const first = parts[0][0].toUpperCase() + parts[0].slice(1);
  const text = `${[first, ...parts.slice(1)].join("; ")}. ${constrained || essential ? "Expect selection against knockout clones." : "Knockout clones may outgrow the rest."}`;
  return { tone: "warn", key: "constraint", short: constrained || essential ? "the gene is constrained or essential" : "knockout cells may outgrow the rest", text };
}

export function buildTakeHome({ designResult: d, biomniReport: b = null } = {}) {
  if (!d || d.err) return null;
  const gene = d.gene || b?.intent?.gene || "the gene";
  const guides = (d.gs || []).slice(0, 2).map((g, i) => ({ n: g.n, name: `gRNA${i + 1}`, short: `gRNA${i + 1}`, spacer: g.sp, pam: g.pm || g.pam, strand: g.str, gc: g.gc, lofPct: g.ko?.outcomes?.lofPct ?? null }));
  const status = statusOf(d);
  const flags = [];
  let headline; let bottomLine; const facts = []; let nextSteps = []; let openChecks = [];

  if (d.type === "ko") {
    const exon = d.transcriptExon && d.transcriptExon === d.codingExon ? `exon ${d.codingExon}` : d.transcriptExon ? exonLabel(d.codingExon, d.transcriptExon - d.codingExon) : (d.codingExon ? `coding exon ${d.codingExon}` : "the coding sequence");
    const spacing = d.deletionOutcome?.deletionSize ?? d.koAssessment?.between?.sizeBp ?? null;
    const tier = d.koAssessment?.tier || null;
    const minLof = d.koOutcomes?.minLofPct ?? d.koAssessment?.outcomes?.minLofPct ?? null;
    const frameshift = d.deletionOutcome?.frameshiftPredicted;
    headline = guides.length === 2
      ? `Two guides cut ${spacing ?? "?"} bp apart in ${exon} of ${gene}; the segment between them is deleted${frameshift === true ? " and the reading frame shifts" : frameshift === false ? " and the reading frame is kept" : ""}.`
      : `One guide cuts ${gene} in ${exon}.`;
    const lofPart = Number.isFinite(minLof) ? `; the weaker guide gives at least ${pct(minLof)} loss-of-function alleles` : "";
    if (tier === "escape" || tier === "truncation") bottomLine = "Do not order this pair: frameshifts here may escape nonsense-mediated decay and leave a truncated protein.";
    else if (tier === "marginal") bottomLine = `Usable but marginal: some frameshifts may only partly trigger nonsense-mediated decay${lofPart}.`;
    else bottomLine = `Use this pair. Frameshifts are predicted to trigger nonsense-mediated decay${lofPart}.`;
    facts.push({ label: "Guides", value: guides.map((g) => `${g.spacer} (${g.strand})`).join("  +  "), note: spacing != null ? `${spacing} bp apart` : "" });
    facts.push({ label: "Predicted protein loss", value: Number.isFinite(minLof) ? `\u2265 ${pct(minLof)}` : "not predicted", note: Number.isFinite(minLof) ? `weaker guide, Lindel; ${tier || "tier unknown"}` : "needs the SpCas9 repair model" });
    const cc = b?.cutCoverage;
    if (cc?.ok) {
      const weakest = (key) => (cc.guides || []).map((g) => g[key]).filter(Boolean).sort((x, y) => x.covered / x.total - y.covered / y.total)[0];
      const rs = weakest("refseq"); const en = weakest("ensembl");
      facts.push({ label: "Transcripts hit", value: [rs && `${rs.covered}/${rs.total} RefSeq`, en && `${en.covered}/${en.total} Ensembl`].filter(Boolean).join(" \u00b7 "), note: "cut inside the coding sequence" });
    } else facts.push({ label: "Transcripts hit", value: "not checked", note: cc ? "needs a network connection and genomic coordinates" : "" });
    const sp = b?.screeningPower; const ga = b?.genotypingAssay;
    facts.push({ label: "Clones to screen", value: sp?.ok && sp.recommendedClonesToScreen != null ? `${sp.recommendedClonesToScreen}` : "not estimated", note: [sp?.ok ? `about ${pct(sp.predictedBiallelicClonePct)} biallelic` : null, ga?.ok && ga.deletionBp ? `PCR ${ga.wtAmpliconBp} \u2192 ${ga.editedAmpliconBp} bp` : null].filter(Boolean).join("; ") });

    if (tier === "escape" || tier === "truncation") flags.push({ tone: "bad", key: "tier", text: d.koAssessment?.summary || "Frameshifts may escape nonsense-mediated decay." });
    const iso = isoformFlag(d, b?.cutCoverage); if (iso) flags.push(iso);
    const variant = commonVariantFlag(b?.variantScreen, guides); if (variant) flags.push(variant);
    const constraint = constraintFlag(b?.viability); if (constraint) flags.push(constraint);
    if (d.pairChangedByIsoformEvidence) flags.push({ tone: "info", key: "pairChanged", text: "Transcript evidence changed the pair; the report shows both." });
    flags.push({ tone: "info", key: "offtargets", text: "Off-targets are not checked: run Cas-OFFinder before ordering." });
    openChecks = ["off-targets", "variants in your line", "protein loss"];
    // the bottom line carries the one thing most likely to matter: the first warning, in a few words
    const risk = [...flags].sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]).find((f) => f.tone === "warn" && f.short);
    const userPair = d.koPairChoice?.source === "user"
      ? `You chose this pair${d.koPairChoice.recommended ? ` (weaker guide ${pct(d.koPairChoice.minLofPct) || "not predicted"}; the selector's pair ${pct(d.koPairChoice.recommended.minLofPct) || "not predicted"})` : ""}. ` : "";
    bottomLine = `${userPair}${bottomLine}${risk ? ` Main risk: ${risk.short}.` : ""}`;
    nextSteps = [
      "Check off-targets: download the Cas-OFFinder input and search your line's genome.",
      "Order the two guides and the screening primers (Proceed to Order).",
      `Screen ${sp?.ok && sp.recommendedClonesToScreen != null ? sp.recommendedClonesToScreen : "the"} clones by PCR${ga?.ok && ga.deletionBp ? ` (wild type ${ga.wtAmpliconBp} bp, deletion ${ga.editedAmpliconBp} bp)` : ""}, confirm by Sanger/ICE, then show protein loss by Western.`,
    ];
  } else {
    const kind = TYPE_NAME[d.type] || d.type || "edit";
    headline = `${kind[0].toUpperCase()}${kind.slice(1)} of ${gene}${d.mutation ? ` (${d.mutation})` : ""}${guides.length ? `: ${guides.length} guide${guides.length > 1 ? "s" : ""}${d.dl ? ` and a ${d.dl} bp donor` : d.os?.length ? " and a donor" : ""}` : ""}.`;
    bottomLine = status.tone === "bad" ? "Not ready: see the blocking items." : "Review the guide, donor and primers before ordering.";
    facts.push({ label: "Guides", value: guides.map((g) => `${g.spacer} (${g.strand})`).join("  +  ") || "none", note: "" });
    if (d.dl) facts.push({ label: "Donor", value: `${d.dl} bp`, note: "" });
    if (d.amp) facts.push({ label: "Screening PCR", value: String(d.amp), note: "" });
    for (const text of [...(d.procurement?.blockers || []), ...(d.procurement?.warnings || [])].slice(0, 3)) flags.push({ tone: (d.procurement?.blockers || []).includes(text) ? "bad" : "warn", key: "procurement", text: clip(text) });
    nextSteps = ["Review the guide, donor and primers in the report.", "Check genome-wide specificity before ordering.", "Order, then confirm each clone by sequencing."];
    openChecks = ["genome-wide specificity"];
  }

  const ordered = flags.map((f, i) => ({ ...f, i })).sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone] || x.i - y.i).map(({ i, ...f }) => ({ ...f, text: clip(f.text, 230) }));
  const MAX = 4;
  return { type: d.type, gene, headline, bottomLine, status: { ...status, detail: openChecks.length ? `${openChecks.length} checks are still open: ${openChecks.join(", ")}.` : "" }, facts, watch: ordered.slice(0, MAX), watchMore: Math.max(0, ordered.length - MAX), nextSteps, guides };
}

/** The take-home as plain lines (text report, tests). */
export function takeHomeLines(t) {
  if (!t) return [];
  return [t.headline, t.bottomLine, `${t.status.label}${t.status.detail ? `. ${t.status.detail}` : ""}`, ...t.facts.map((f) => `${f.label}: ${f.value}${f.note ? ` (${f.note})` : ""}`), ...t.watch.map((w) => `Watch: ${w.text}`), ...t.nextSteps.map((s, i) => `${i + 1}. ${s}`)];
}
