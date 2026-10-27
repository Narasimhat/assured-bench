import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, Download, Upload, Play, Search } from "lucide-react";
import { parseGB } from "../../engine/design/designEngine.js";
import { normalizeGenBankToTranscriptModel } from "../../engine/design/transcriptModel.js";
import { buildPmCandidateSet } from "../../engine/design/pmCandidates.js";
import { alphaGenomeMapping } from "../../services/alphaGenomeReview.js";
import { REGULATORY_CONTEXT_CATALOG } from "../../services/regulatoryContexts.js";
import { HUMAN_CHROMOSOMES, buildCandidateRankingRequest, normalizeChromosome, rankCandidates, validateRankingReport } from "../../services/candidateRanking.js";
import { mappingNote, useMappingLookup } from "./useMappingLookup.js";
import { HELPER_START_COMMAND, checkHelper, loadHelperSettings, runHelperComparison, saveHelperSettings } from "../../services/alphaGenomeHelper.js";

const fmtCfd = (v) => (Number.isFinite(v) ? v.toFixed(v === 0 ? 0 : 4) : "\u2014");
const FLAG_TEXT = {
  pamDisrupted: "PAM disrupted by the repair",
  singleMismatchIntactPam: "one spacer mismatch, PAM intact",
  cfdExactlyZero: "CFD exactly 0 (sparse table cell)",
  gcOutside40to60: "GC outside 40\u201360%",
};
const SHOW_FLAGS = ["pamDisrupted", "singleMismatchIntactPam", "gcOutside40to60"];
const GATE_TEXT = { G1: "protein change", G2: "re-cut protection", G3: "cut distance", G4: "donor arm", G5: "spacer uniqueness", G6: "GC limits" };

function helperStatusText(state) {
  switch (state.status) {
    case "checking": return "Checking the helper\u2026";
    case "running": return "Running. The first comparison for a locus also builds the null of random silent changes (about 90 predictions; seconds to a few minutes depending on your API quota); later runs reuse it. Keep the helper's terminal open.";
    case "done": return `Comparison finished at ${state.finishedAt}; the report was checked against this request and ranked below.`;
    case "down": return state.message;
    case "ok": return `Helper connected${state.health?.keyConfigured ? "; AlphaGenome key configured" : "; no AlphaGenome key configured on that computer"}${state.health?.sdkVersion ? `; SDK ${state.health.sdkVersion}` : ""}${Number.isFinite(state.health?.nullsCached) ? `; ${state.health.nullsCached} null${state.health.nullsCached === 1 ? "" : "s"} cached` : ""}.`;
    default: return "Not connected yet. Nothing is sent until you click.";
  }
}

function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Matched guide + donor pairs for a point mutation, in one place: the pairs that passed the core design checks, why each ranked where it did,
 * and, when an AlphaGenome ranking report has been imported, which pairs are equally supported. Applying a pair reruns the design for that
 * guide and that donor version. Genome-wide specificity is never assessed here and is stated on screen.
 */
export function PmCandidatePicker({ project, result, busy = false, onUseCandidate, initialRanking = null, defaultShowAlternatives = false, defaultShowExcluded = false, helperFetch, initialHelper = null, lookupFetch, initialLookup = null }) {
  const [showAlternatives, setShowAlternatives] = useState(defaultShowAlternatives);
  const [showExcluded, setShowExcluded] = useState(defaultShowExcluded);
  const [ranking, setRanking] = useState(initialRanking);
  const [pending, setPending] = useState(null); // { request, alleleOfCandidate, contexts } exported but not yet answered
  const [error, setError] = useState("");
  // Local helper (tools/alphagenome/helper.py). Nothing is contacted until the user clicks: a browser may ask permission for local-network access.
  const [helper, setHelper] = useState(() => ({ ...loadHelperSettings(), ...(initialHelper?.settings || {}) }));
  const [helperState, setHelperState] = useState(initialHelper?.state || { status: "unchecked" }); // unchecked | checking | ok | down | running | done
  const fetchFn = helperFetch || (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
  // The mapping reader on main needs a "chromosome:GRCh38:..." line; Ensembl-style records say "GRCh38 ... Location: chr19 start-end". Prefill only; the user confirms.
  const detected = useMemo(() => {
    const exact = alphaGenomeMapping(project);
    if (exact) return exact;
    const raw = String(project?.genbankRaw || "");
    const m = /GRCh38[\s\S]{0,120}?Location:\s*chr([0-9XY]+)\s+(\d+)-(\d+)/i.exec(raw);
    return m ? { chromosome: m[1].toUpperCase(), referenceStart: Number(m[2]) } : null;
  }, [project?.genbankRaw]);
  const fromReference = (d) => ({ chromosome: HUMAN_CHROMOSOMES.includes(normalizeChromosome(d?.chromosome)) ? normalizeChromosome(d.chromosome) : "", referenceStart: d?.referenceStart || "", confirmed: false });
  const [mapping, setMapping] = useState(() => (initialLookup?.status === "ok" ? { chromosome: initialLookup.result.chromosome, referenceStart: initialLookup.result.referenceStart, confirmed: false } : fromReference(detected)));
  // A different reference (another gene, a re-upload) must not keep the previous one's mapping, nor its confirmation.
  const firstRender = React.useRef(true);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } setMapping(fromReference(detected)); }, [project?.genbankRaw]); // eslint-disable-line react-hooks/exhaustive-deps
  const [primary, setPrimary] = useState("wtc11");
  const [second, setSecond] = useState("");

  const options = useMemo(() => ({ ...(project?.options || {}), expectedGene: result?.gene || project?.gene, allowNonCodingBlockers: true }), [project?.options, result?.gene]);
  const built = useMemo(() => {
    try {
      const model = normalizeGenBankToTranscriptModel(parseGB(project.genbankRaw), { expectedGene: options.expectedGene });
      return buildPmCandidateSet(model, { wtAA: result.wA, aaNumber: result.an, mutAA: result.mA }, { maxBlockingChanges: Number(options.maxBlockingChanges) || 3, allowNonCodingBlockers: true });
    } catch (e) { return { err: String(e?.message || e) }; }
  }, [project?.genbankRaw, result, options]);
  const geneSymbol = result?.gene || project?.gene || options.expectedGene;
  // When the reference does not state where it sits in GRCh38, work it out from the design (gene and edit site) and Ensembl; see services/referenceMapping.js.
  const { lookup, start: runLookup } = useMappingLookup({
    enabled: !detected && Boolean(built && !built.err && geneSymbol), gene: geneSymbol, sequence: (result?.gb || project?.designResult?.gb)?.genomicSequence,
    editIndex: built?.edit?.positions?.[0], orientations: [1], resetKey: project?.genbankRaw, fetchImpl: lookupFetch, initial: initialLookup,
    apply: (out, overwrite) => setMapping((m) => (overwrite || (!m.chromosome && !m.referenceStart) ? { chromosome: out.chromosome, referenceStart: out.referenceStart, confirmed: false } : m)),
  });
  if (!built || built.err) return <section aria-label="Matched guide and donor pairs"><p className="muted">Matched pairs are not available for this design{built?.err ? ` (${built.err})` : ""}.</p></section>;

  const current = result?.gs?.length === 1 ? result.gs[0].sp : null;
  const currentDonor = result?.os?.[0]?.genomicDonor;
  const ranked = ranking ? Object.fromEntries(ranking.ranking.map((r) => [r.id, r])) : {};
  const topIds = new Set(ranking ? ranking.top : built.candidates.filter((c) => c.stage1.tier === 1).map((c) => c.id));
  const lead = built.candidates.filter((c) => topIds.has(c.id));
  const rest = built.candidates.filter((c) => !topIds.has(c.id));
  const catalog = REGULATORY_CONTEXT_CATALOG.contexts.filter((c) => c.available);
  const start = Number(mapping.referenceStart);
  const missing = [
    ...(HUMAN_CHROMOSOMES.includes(normalizeChromosome(mapping.chromosome)) ? [] : ["select the chromosome"]),
    ...(Number.isSafeInteger(start) && start >= 1 ? [] : ["enter the GRCh38 position (1-based) of the first base of the uploaded sequence"]),
    ...(mapping.confirmed ? [] : ["tick \u201cI checked this mapping\u201d"]),
  ];

  const setupOptions = () => ({
    contexts: [primary, ...(second && second !== primary ? [second] : [])], mappingConfirmed: mapping.confirmed,
    mapping: { assembly: "GRCh38", chromosome: String(mapping.chromosome), referenceStart: Number(mapping.referenceStart), orientation: 1 },
  });
  const exportRequest = async () => {
    setError("");
    try {
      const setup = await buildCandidateRankingRequest(project, built, setupOptions());
      setPending(setup); download(`alphagenome-candidates-${setup.request.requestId.slice(0, 12)}.json`, setup.request);
    } catch (e) { setError(String(e?.message || e)); }
  };
  const importReport = async (event) => {
    setError("");
    try {
      if (!pending) throw new Error("Export the request first; a report is matched to the request it answers.");
      const report = JSON.parse(await event.target.files[0].text());
      validateRankingReport(report, pending.request);
      setRanking(rankCandidates(built, { ...pending, report }));
    } catch (e) { setError(String(e?.message || e)); }
    event.target.value = "";
  };
  const changeHelper = (patch) => { const next = { ...helper, ...patch }; setHelper(next); saveHelperSettings(patch); };
  const checkConnection = async () => {
    setError(""); setHelperState({ status: "checking" });
    const out = await checkHelper(helper.url, { fetchFn });
    setHelperState(out.ok ? { status: "ok", health: out.health } : { status: "down", message: out.message });
  };
  const runHere = async () => {
    setError(""); setHelperState({ status: "running" });
    try {
      const out = await runHelperComparison(project, built, { ...setupOptions(), url: helper.url, token: helper.token, fetchFn });
      setPending(out.setup); setRanking(out.ranking); setHelperState({ status: "done", finishedAt: new Date().toLocaleTimeString() });
    } catch (e) { setHelperState({ status: "unchecked" }); setError(String(e?.message || e)); }
  };

  const row = (c) => {
    const r = ranked[c.id];
    const isCurrent = current === c.guide.sp && currentDonor === c.donor.genomicDonor;
    const flags = SHOW_FLAGS.filter((f) => c.flags[f]).map((f) => FLAG_TEXT[f]);
    const regulatory = !r ? "Not run" : r.flagged ? `Flagged (p ${r.contexts[ranking.primaryContext.ontology].p.toFixed(2)})` : ranking.tie && r.top ? "Equally supported" : r.top ? "Best-supported" : "Not flagged";
    return <tr key={c.id}>
      <td style={{ padding: 8, fontWeight: 600 }}>{c.label}</td>
      <td style={{ padding: 8, fontFamily: "monospace" }}>{c.guide.sp} <span style={{ color: "var(--warning)" }}>{c.guide.pam}</span> ({c.guide.str})</td>
      <td style={{ padding: 8 }}>{Math.abs(c.protection.cutToEditBp)} bp</td>
      <td style={{ padding: 8 }}>{c.guide.gc}%</td>
      <td style={{ padding: 8 }}>{c.blockers.map((b) => b.lb).join(", ")}</td>
      <td style={{ padding: 8 }} title="Residual cutting of the repaired allele by this guide (CFD, Doench 2016); lower is better. Below 0.023 counts as strong.">CFD {fmtCfd(c.protection.repairedAlleleCfd)}{flags.length > 0 && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{flags.join("; ")}</div>}</td>
      <td style={{ padding: 8 }} title="Residual cutting if only the intended base converts and no blocker does.">{fmtCfd(c.protection.editOnlyCfd)}</td>
      <td style={{ padding: 8 }}>{regulatory}</td>
      <td style={{ padding: 8 }}><button type="button" className="btn btn-secondary" disabled={busy || isCurrent} onClick={() => onUseCandidate?.(c)} style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}>{isCurrent ? "In use" : <><RefreshCw size={13} /> Use</>}</button></td>
    </tr>;
  };
  const HEAD_TITLE = { "Re-cut protection": "Residual cutting of the repaired allele by this guide (CFD); lower is better", "Edit alone": "Residual cutting if only the intended base converts and no blocking change does", Regulatory: "Model comparison against random silent changes of the same size; not run until a report is imported" };
  const head = <thead><tr>{["Pair", "Guide + PAM", "Cut", "GC", "Blocking changes", "Re-cut protection", "Edit alone", "Regulatory", ""].map((h) => <th key={h || "act"} title={HEAD_TITLE[h]} style={{ padding: 8, textAlign: "left" }}>{h}</th>)}</tr></thead>;
  const note = ranking ? ranking.wording : lead.length > 1 ? `Best tier at the design checks: ${lead.map((c) => c.label).join(" and ")}. No regulatory comparison has been run.` : `Best at the design checks: ${lead[0]?.label}. No regulatory comparison has been run.`;

  return <section aria-label="Matched guide and donor pairs" style={{ margin: "0.25rem 0" }}>
    <h3 style={{ fontSize: "1rem", margin: "0 0 0.25rem" }}>Matched guide + donor pairs</h3>
    <p style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>{built.candidates.length} pair{built.candidates.length === 1 ? "" : "s"} passed the core design checks out of {built.counts.rows} guide and donor versions considered within {built.rule.searchWindowBp} bp. Each pair is one guide with its own ssODN; applying one turns co-delivery off.</p>
    <p role="status" style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>{note}</p>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>{head}<tbody>{lead.map(row)}{showAlternatives && rest.map(row)}</tbody></table></div>
    {rest.length > 0 && <p style={{ margin: "0.4rem 0" }}><button type="button" className="btn btn-secondary" style={{ fontSize: "0.8rem" }} onClick={() => setShowAlternatives((v) => !v)}>{showAlternatives ? "Hide alternatives" : `Show ${rest.length} alternative${rest.length === 1 ? "" : "s"} and why they ranked lower`}</button></p>}
    {showAlternatives && rest.length > 0 && <ul style={{ fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 1rem" }}>{rest.map((c) => <li key={c.id}><strong>{c.label}</strong>: {(ranked[c.id]?.reasonsRankedLower?.length ? ranked[c.id].reasonsRankedLower : [`design-check tier ${c.stage1.tier}`]).join("; ")}.</li>)}</ul>}
    {built.notes.length > 0 && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{built.notes.join(" ")}</p>}
    <p style={{ fontSize: "0.85rem", margin: "0.4rem 0" }}><strong>Not assessed:</strong> genome-wide specificity for every pair. Export the off-target input from the report page and run it before ordering.</p>
    {built.excluded.length > 0 && <p style={{ margin: "0.25rem 0" }}><button type="button" className="btn btn-secondary" style={{ fontSize: "0.8rem" }} onClick={() => setShowExcluded((v) => !v)}>{showExcluded ? "Hide" : "Show"} {built.excluded.length} version{built.excluded.length === 1 ? "" : "s"} that did not pass</button></p>}
    {showExcluded && <ul style={{ fontSize: "0.8rem", margin: "0 0 0.5rem 1rem" }}>{built.excluded.map((e) => <li key={e.id}><code>{e.guide.sp}</code> ({e.guide.str}, version {e.donorVersion + 1}): failed {e.failedGates.map((g) => GATE_TEXT[g] || g).join(", ")}</li>)}</ul>}

    <details style={{ marginTop: "0.75rem" }} open={Boolean(ranking) || undefined}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Regulatory comparison with AlphaGenome (research use)</summary>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>The model compares each pair's blocking changes with the intended edit alone inside the gene, and with random silent changes of the same size. It can demote a pair that departs from those, never rescue one, and it does not predict cutting, HDR or clone fitness. Predictions run on your own computer with your own AlphaGenome key, through the local helper below or by exporting the request; the key never enters the browser. Plus-strand genes only.</p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end", fontSize: "0.85rem" }}>
        <label>Primary context<br /><select value={primary} onChange={(e) => setPrimary(e.target.value)}>{catalog.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Second context (optional)<br /><select value={second} onChange={(e) => setSecond(e.target.value)}><option value="">None</option>{catalog.filter((c) => c.id !== primary).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Chromosome (GRCh38)<br /><select aria-label="Chromosome" value={mapping.chromosome} onChange={(e) => setMapping({ ...mapping, chromosome: e.target.value, confirmed: false })}><option value="">Select…</option>{HUMAN_CHROMOSOMES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Reference start (1-based, GRCh38)<br /><input value={mapping.referenceStart} onChange={(e) => setMapping({ ...mapping, referenceStart: e.target.value, confirmed: false })} style={{ width: "9rem" }} /></label>
        <label><input type="checkbox" checked={mapping.confirmed} onChange={(e) => setMapping({ ...mapping, confirmed: e.target.checked })} /> I checked this mapping</label>
        <button type="button" className="btn btn-secondary" disabled={lookup.status === "running" || !geneSymbol} onClick={() => runLookup({ overwrite: true })} title="Looks up the gene's position in Ensembl (GRCh38), finds your sequence inside it and compares them. Only the gene symbol and coordinates are sent."><Search size={14} /> Fill from design</button>
      </div>
      <p role="note" style={{ fontSize: "0.82rem", margin: "0.4rem 0 0", color: mapping.confirmed && !missing.length ? "var(--text-muted)" : "var(--warning, #8a5a00)" }}>{mappingNote({ missing, detected, lookup, geneSymbol, ready: mapping.confirmed && !missing.length, fromLookup: lookup.status === "ok" && String(lookup.result.referenceStart) === String(mapping.referenceStart) && lookup.result.chromosome === normalizeChromosome(mapping.chromosome) })}</p>
      <div style={{ margin: "0.75rem 0 0.25rem", padding: "0.6rem 0.75rem", border: "1px solid var(--border, #ccc)", borderRadius: 6, fontSize: "0.85rem" }}>
        <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>Run the comparison here</p>
        <p style={{ margin: "0 0 0.4rem" }}>Start the helper once on your computer, from the assured-bench folder: <code>{HELPER_START_COMMAND}</code>. It prints a session code, runs the predictions with your key, and sends back the report this page ranks. The key stays on your computer; the sequence windows go from your computer to Google.</p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
          <label>Helper address<br /><input aria-label="Helper address" value={helper.url} onChange={(e) => changeHelper({ url: e.target.value })} style={{ width: "13rem" }} /></label>
          <label>Session code<br /><input aria-label="Session code" type="password" autoComplete="off" value={helper.token} onChange={(e) => changeHelper({ token: e.target.value })} style={{ width: "11rem" }} /></label>
          <button type="button" className="btn btn-secondary" onClick={checkConnection} disabled={helperState.status === "checking" || helperState.status === "running"}>Check connection</button>
          <button type="button" className="btn btn-primary" onClick={runHere} disabled={helperState.status === "running"}><Play size={14} /> Run AlphaGenome comparison</button>
        </div>
        <p role="status" style={{ margin: "0.4rem 0 0", color: "var(--text-muted)" }}>{helperStatusText(helperState)}</p>
      </div>
      <details style={{ margin: "0.4rem 0" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>No helper: export the request and import the report by hand</summary>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.4rem 0" }}>
          <button type="button" className="btn btn-secondary" onClick={exportRequest}><Download size={14} /> Export request</button>
          <span style={{ fontSize: "0.82rem" }}>then run <code>python3 tools/alphagenome/rank.py --run request.json --output report.json</code></span>
          <label className="btn btn-secondary" style={{ cursor: pending ? "pointer" : "not-allowed", opacity: pending ? 1 : 0.6 }}><Upload size={14} /> Import report<input type="file" accept="application/json" onChange={importReport} disabled={!pending} style={{ display: "none" }} /></label>
        </div>
      </details>
      {error && <p role="alert" style={{ color: "var(--danger, #b00020)" }}>{error}</p>}
      {ranking && <p style={{ fontSize: "0.82rem" }}>{ranking.primaryContext.label}: predicted exon RNA-seq of the reference allele (plus strand) averages {ranking.primaryContext.referenceExonMeanPlus.toFixed(2)}{ranking.primaryContext.informative ? "" : "; too low to rank on"}. {ranking.modelSeparatesCandidates ? "The model flagged at least one pair." : "The model did not separate any pair from random silent changes."} {ranking.tie && ranking.tieBreak ? `If one pair must be ordered first, a ${ranking.tieBreak.basis} gives ${ranking.tieBreak.order.map((id) => built.candidates.find((c) => c.id === id)?.label).join(", then ")}.` : ""}</p>}
    </details>
  </section>;
}
