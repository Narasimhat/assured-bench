import React, { useEffect, useRef, useState } from "react";
import { ENZYMES } from "../../engine/design/enzymeConfig.js";
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from "../../engine/design/designScheme.js";
import { AGENT_PRIORITIES, agentRequest, agentAudit, agentEvidenceGaps, isAgentAudit, workflowNextSteps, qcNextAction } from "../../services/workflowAgent.js";
import { BIOMNI_PRESET_MISSIONS, runBiomniCoScientist } from "../../services/biomniAgent.js";

export function WorkflowAgent({ project, onUpdateProject }) {
  const [enzymes, setEnzymes] = useState(() => Object.keys(ENZYMES));
  const [priority, setPriority] = useState("balanced");
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [biomniPrompt, setBiomniPrompt] = useState(() => BIOMNI_PRESET_MISSIONS[0].prompt);
  const [biomniRunning, setBiomniRunning] = useState(false);
  const [biomniProgress, setBiomniProgress] = useState(null);
  const [biomniResult, setBiomniResult] = useState(null);
  const [biomniError, setBiomniError] = useState("");
  const worker = useRef(null);
  const panel = useRef(null);
  let request, inputError = "";
  try { request = agentRequest(project, enzymes, priority); } catch (e) { inputError = e.message; }
  const requestKey = request ? JSON.stringify(request) : inputError;
  const latest = useRef(requestKey);
  latest.current = requestKey;

  useEffect(() => {
    worker.current?.terminate(); worker.current = null;
    setProgress(null); setReport(null); setError("");
    return () => { worker.current?.terminate(); worker.current = null; };
  }, [requestKey]);

  const runCoScientist = async (customPrompt) => {
    const activePrompt = (typeof customPrompt === "string" ? customPrompt : biomniPrompt).trim();
    if (!activePrompt || biomniRunning) return;
    if (typeof customPrompt === "string") setBiomniPrompt(customPrompt);
    setBiomniRunning(true);
    setBiomniError("");
    setBiomniResult(null);
    setBiomniProgress({ completedSteps: [], currentStep: { title: "Initializing ASSURED-E1 Biomedical Environment..." }, totalSteps: 5 });
    try {
      const res = await runBiomniCoScientist(activePrompt, project, {
        onStep: (stepState) => setBiomniProgress(stepState),
      });
      setBiomniResult(res);
      setBiomniProgress(null);
    } catch (e) {
      setBiomniError(e.message || String(e));
      setBiomniProgress(null);
    } finally {
      setBiomniRunning(false);
    }
  };

  const applyBiomniToWorkbench = () => {
    if (!biomniResult?.designResult) return;
    const { intent, geneMeta, genbankRaw, designResult, enzymeComparison } = biomniResult;
    const config = ENZYMES[intent.enzyme] || ENZYMES.spcas9;
    const audit = enzymeComparison ? agentAudit(enzymeComparison, intent.enzyme) : null;
    const result = audit ? { ...designResult, workflowRecommendation: audit } : designResult;
    onUpdateProject({
      gene: intent.gene,
      ...(geneMeta ? { geneMeta } : {}),
      ...(genbankRaw ? { genbankRaw } : {}),
      editType: intent.editType,
      mutation: intent.mutation || "",
      tag: intent.tag || project.tag || "FLAG",
      options: {
        ...project.options,
        enzyme: intent.enzyme,
        spacerLength: config.spacer_len.default,
        directRepeat: config.direct_repeat || "",
        repeatVerified: false,
        repeatSource: "",
        customGuides: [],
      },
      designResult: result,
      svgScheme: buildDesignSchemeSvg(result),
      caption: buildDesignSchemeCaption(result),
      status: result.procurement?.status || "review",
      ...(audit ? { workflowRecommendation: audit } : {}),
    });
    requestAnimationFrame(() => {
      const target = document.getElementById("bench-design-report");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };

  const compare = () => {
    if (!request || worker.current) return;
    const key = requestKey;
    setError(""); setReport(null); setProgress({ completed: 0, total: enzymes.length, enzyme: "Starting" });
    try {
      const active = new Worker(new URL("../../services/workflowAgent.worker.js", import.meta.url), { type: "module" });
      worker.current = active;
      active.onmessage = ({ data }) => {
        if (latest.current !== key || worker.current !== active) return;
        if (data.type === "progress") setProgress(data.progress);
        else {
          active.terminate(); worker.current = null; setProgress(null);
          if (data.type === "complete") setReport({ ...data.report, requestKey: key });
          else setError(data.error);
        }
      };
      active.onerror = () => { if (worker.current !== active || latest.current !== key) return; active.terminate(); worker.current = null; setProgress(null); setError("The comparison could not complete. Try fewer enzymes or a smaller reference."); };
      active.postMessage(request);
    } catch (e) { worker.current?.terminate(); worker.current = null; setProgress(null); setError(e.message); }
  };
  const cancel = () => { worker.current?.terminate(); worker.current = null; setProgress(null); setError("Comparison cancelled."); };
  const visible = report?.requestKey === requestKey ? report : (isAgentAudit(project.workflowRecommendation) ? agentAudit(project.workflowRecommendation, project.workflowRecommendation.selectedEnzyme) : null);
  const apply = candidate => {
    if (!candidate.eligible || !candidate.result || report?.requestKey !== latest.current) return;
    const config = ENZYMES[candidate.enzyme];
    const { requestKey: ignored, ...clean } = report;
    const audit = agentAudit(clean, candidate.enzyme);
    const result = { ...candidate.result, workflowRecommendation: audit };
    panel.current?.querySelectorAll("details").forEach(detail => { detail.open = false; });
    onUpdateProject({
      options: { ...request.options, enzyme: candidate.enzyme, spacerLength: config.spacer_len.default,
        directRepeat: config.direct_repeat || "", repeatVerified: false, repeatSource: "", customGuides: [] },
      ...(result.type === "genomic-snv" ? { gene: result.gene,
        mutation: `chr${result.input.chromosome}:${result.input.position} ${result.input.ref}>${result.input.alt}` } : {}),
      designResult: result, svgScheme: buildDesignSchemeSvg(result), caption: buildDesignSchemeCaption(result),
      status: result.procurement?.status || "review", workflowRecommendation: audit,
    });
    requestAnimationFrame(() => {
      const target = document.getElementById("bench-design-report");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };
  const download = () => {
    if (!visible) return;
    const { requestKey: ignored, ...clean } = visible;
    const selected = project.workflowRecommendation?.inputSha256 === clean.inputSha256 ? project.workflowRecommendation.selectedEnzyme : null;
    const blob = new Blob([JSON.stringify(agentAudit(clean, selected), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "assured-workflow-recommendation.json"; a.click(); URL.revokeObjectURL(url);
  };
  const recommended = visible?.candidates.filter(c => c.recommended) || [];
  return <section ref={panel} className="card workflow-agent" aria-labelledby="workflow-agent-title">
    <h2 id="workflow-agent-title">Workflow agent &amp; Biomni Co-Scientist <span className="agent-optional">Optional</span></h2>
    <p className="muted">Run an autonomous Stanford Biomni-style biomedical workflow or compare nuclease options for your modification.</p>

    <details className="agent-details" open>
      <summary><strong>🧬 Biomni Co-Scientist (Autonomous Multi-Step Agent · ASSURED-E1)</strong></summary>
      <p className="muted" style={{ marginTop: "0.4rem" }}>
        Describe your genome editing goal in plain English. The agent decomposes your prompt into a multi-step plan across Ensembl, UniProtKB, NCBI ClinVar, 7-enzyme ASSURED CRISPR Design, JavaScript Lindel KO repair modeling, and clonal screening power analysis.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", margin: "0.5rem 0" }}>
        {BIOMNI_PRESET_MISSIONS.map(m => (
          <button
            key={m.id}
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
            disabled={biomniRunning}
            onClick={() => runCoScientist(m.prompt)}
          >
            ✨ {m.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: " stretch", margin: "0.5rem 0" }}>
        <input
          type="text"
          value={biomniPrompt}
          disabled={biomniRunning}
          onChange={e => setBiomniPrompt(e.target.value)}
          placeholder="e.g., Design R175H point mutation knock-in for TP53, check ClinVar & UniProt domains, and compare all enzymes"
          style={{ flex: 1, padding: "0.45rem 0.65rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={biomniRunning || !biomniPrompt.trim()}
          onClick={() => runCoScientist()}
        >
          {biomniRunning ? "Running Agent..." : "🚀 Run Co-Scientist"}
        </button>
      </div>

      {biomniProgress && (
        <div role="status" aria-live="polite" style={{ padding: "0.6rem", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0", marginTop: "0.5rem" }}>
          <strong>⚡ Executing ASSURED-E1 Plan ({biomniProgress.completedSteps?.length || 0}/{biomniProgress.totalSteps} steps)</strong>
          {biomniProgress.currentStep && <p className="muted" style={{ margin: "0.25rem 0 0" }}>Current: {biomniProgress.currentStep.title}</p>}
        </div>
      )}

      {biomniError && <p role="alert" className="error">{biomniError}</p>}

      {biomniResult && (
        <div className="biomni-result" style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>
              Co-Scientist Report: {biomniResult.intent.gene} ({biomniResult.intent.editType.toUpperCase()}
              {biomniResult.intent.mutation ? ` · ${biomniResult.intent.mutation}` : ""})
            </h3>
            {biomniResult.designResult && (
              <button type="button" className="btn btn-primary" onClick={applyBiomniToWorkbench}>
                ✅ Apply Co-Scientist Design to Workbench
              </button>
            )}
          </div>

          <p className="muted" style={{ margin: "0.4rem 0" }}>
            Executed {biomniResult.steps.length} autonomous tool steps across ASSURED-E1 ({ENZYMES[biomniResult.intent.enzyme]?.name || biomniResult.intent.enzyme}).
          </p>

          <details style={{ marginTop: "0.5rem" }}>
            <summary><strong>Step-by-Step ASSURED-E1 Tool Execution Trace ({biomniResult.steps.length} steps)</strong></summary>
            <ol style={{ margin: "0.4rem 0", paddingLeft: "1.25rem" }}>
              {biomniResult.steps.map(s => (
                <li key={s.step} style={{ marginBottom: "0.35rem" }}>
                  <strong>{s.title}</strong> <code>[{s.tool}]</code> ({s.durationMs} ms) —{" "}
                  <span style={{ color: s.status === "completed" ? "#15803d" : "#b45309" }}>{s.status.toUpperCase()}</span>
                  <div className="muted" style={{ fontSize: "0.82rem" }}>{s.rationale}</div>
                  {s.output?.source && <div style={{ fontSize: "0.8rem", color: "#0f766e" }}>✓ Source: {s.output.source} ({s.output.sequenceLength} bp)</div>}
                  {s.output?.error && <div style={{ fontSize: "0.8rem", color: "#b91c1c" }}>⚠ {s.output.error}</div>}
                </li>
              ))}
            </ol>
          </details>

          {biomniResult.isoformAnalysis?.ok && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.88rem", padding: "0.5rem 0.65rem", background: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
              <strong>🧬 Pan-Isoform Common Exon Analysis ({biomniResult.isoformAnalysis.totalIsoforms} Coding Isoform{biomniResult.isoformAnalysis.totalIsoforms === 1 ? "" : "s"} · {biomniResult.isoformAnalysis.source}):</strong>
              <div style={{ marginTop: "0.25rem" }}>
                Recommended NMD-Safe Common Coding Exon(s):{" "}
                <strong>
                  {biomniResult.isoformAnalysis.recommendedCommonKoExons?.length
                    ? biomniResult.isoformAnalysis.recommendedCommonKoExons.map(n => `Exon ${n}`).join(", ")
                    : "Exon 1"}
                </strong>
                {biomniResult.designResult?.exon && (
                  <span> · Selected Workbench Target: <code>{biomniResult.designResult.exon}</code></span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.35rem" }}>
                {(biomniResult.isoformAnalysis.exons || []).map(ex => (
                  <span
                    key={ex.codingExon}
                    style={{
                      fontSize: "0.76rem",
                      padding: "0.15rem 0.45rem",
                      borderRadius: "4px",
                      background: ex.recommendedForKo ? "#dcfce7" : ex.isTerminalExon ? "#fef3c7" : "#e2e8f0",
                      border: ex.recommendedForKo ? "1px solid #22c55e" : "1px solid #cbd5e1",
                    }}
                  >
                    <strong>Exon {ex.codingExon}</strong> ({ex.lengthBp} bp): {ex.sharedIsoforms}/{ex.totalIsoforms} ({ex.coveragePct}%)
                    {ex.recommendedForKo ? " ✅ Common" : ex.isTerminalExon ? " ⚠ Terminal" : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {biomniResult.designResult?.gs?.length > 0 && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
              <strong>Selected ASSURED Guides ({biomniResult.designResult.gs.length}):</strong>{" "}
              {biomniResult.designResult.gs.slice(0, 2).map((g, i) => (
                <span key={i} style={{ marginRight: "0.6rem" }}>
                  <code>{g.sp}</code> ({g.pm || g.pam}, {g.str})
                </span>
              ))}
              {biomniResult.designResult.koAssessment && (
                <span>
                  {" "}· <strong>KO Protein-Loss Tier:</strong> <code>{biomniResult.designResult.koAssessment.tier.toUpperCase()}</code>
                  {(biomniResult.designResult.koOutcomes?.minLofPct ?? biomniResult.designResult.koAssessment.outcomes?.minLofPct) != null && (
                    <span> (Min Lindel LoF: <strong>{biomniResult.designResult.koOutcomes?.minLofPct ?? biomniResult.designResult.koAssessment.outcomes?.minLofPct}%</strong>)</span>
                  )}
                </span>
              )}
            </div>
          )}

          {biomniResult.uniprot?.found && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
              <strong>UniProtKB ({biomniResult.uniprot.accession}):</strong> {biomniResult.uniprot.proteinName} ({biomniResult.uniprot.lengthAa} aa)
              {biomniResult.uniprot.domains?.length > 0 && (
                <div className="muted">
                  Domains/Sites: {biomniResult.uniprot.domains.map(d => `${d.description} (${d.start}–${d.end} aa)`).join(", ")}
                </div>
              )}
            </div>
          )}

          {biomniResult.clinvar?.variants?.length > 0 && (
            <div style={{ marginTop: "0.45rem", fontSize: "0.9rem" }}>
              <strong>ClinVar Evidence:</strong>{" "}
              {biomniResult.clinvar.variants.slice(0, 2).map(v => `${v.accession || v.uid}: ${v.title} (${v.clinicalSignificance})`).join(" | ")}
            </div>
          )}

          {biomniResult.lindelRanking?.topGuides?.length > 0 && (
            <details style={{ marginTop: "0.5rem" }} open>
              <summary><strong>Lindel KO Repair Outcome Ranking (Common-Exon Prioritized · Top {(biomniResult.lindelRanking.displayGuides || biomniResult.lindelRanking.topGuides.slice(0, 5)).length} of {biomniResult.lindelRanking.totalCandidates} Guides)</strong></summary>
              <div style={{ overflowX: "auto", marginTop: "0.4rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>
                      <th style={{ padding: "0.25rem" }}>Rank</th>
                      <th style={{ padding: "0.25rem" }}>Spacer</th>
                      <th style={{ padding: "0.25rem" }}>Exon</th>
                      <th style={{ padding: "0.25rem" }}>Isoform Coverage</th>
                      <th style={{ padding: "0.25rem" }}>GC %</th>
                      <th style={{ padding: "0.25rem" }}>Tier</th>
                      <th style={{ padding: "0.25rem" }}>Lindel FS %</th>
                      <th style={{ padding: "0.25rem" }}>Predicted LoF Allele %</th>
                      <th style={{ padding: "0.25rem" }}>Biallelic KO Clone %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(biomniResult.lindelRanking.displayGuides || biomniResult.lindelRanking.topGuides.slice(0, 5)).map((g, idx) => (
                      <tr
                        key={`${g.spacer}-${idx}`}
                        style={{
                          borderBottom: "1px solid #e2e8f0",
                          background: g.selected_in_pair ? "#eff6ff" : "transparent",
                        }}
                      >
                        <td style={{ padding: "0.25rem" }}>#{g.lindel_rank || idx + 1}</td>
                        <td style={{ padding: "0.25rem" }}>
                          <code>{g.spacer}</code> ({g.pam}, {g.strand})
                          {g.selected_in_pair ? (
                            <span
                              style={{
                                marginLeft: "0.35rem",
                                padding: "0.08rem 0.35rem",
                                borderRadius: "4px",
                                background: "#dbeafe",
                                color: "#1d4ed8",
                                fontSize: "0.72rem",
                                fontWeight: 600,
                              }}
                            >
                              ★ Selected Pair
                            </span>
                          ) : null}
                          {g.brunello_match ? (
                            <span
                              style={{
                                marginLeft: "0.35rem",
                                padding: "0.08rem 0.35rem",
                                borderRadius: "4px",
                                background: "#fef3c7",
                                color: "#92400e",
                                fontSize: "0.72rem",
                                fontWeight: 600,
                              }}
                              title={`Broad GPP Brunello Library (${g.brunello_match.libraryGene}) · Rule Set 2 = ${g.brunello_match.ruleSet2}`}
                            >
                              📚 Brunello #{g.brunello_match.brunelloRank} (RS2 {g.brunello_match.ruleSet2})
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: "0.25rem" }}>Exon {g.coding_exon}</td>
                        <td style={{ padding: "0.25rem" }}>
                          {g.shared_isoforms_label || `${g.isoform_coverage_pct ?? 100}%`}
                          {g.is_common_exon ? " ✅ Common" : ""}
                        </td>
                        <td style={{ padding: "0.25rem" }}>{g.gc_percent}%</td>
                        <td style={{ padding: "0.25rem" }}>{g.panel_tier}</td>
                        <td style={{ padding: "0.25rem" }}>{g.lindel_frameshift_pct}%</td>
                        <td style={{ padding: "0.25rem" }}><strong>{g.predicted_LoF_allele_pct}%</strong></td>
                        <td style={{ padding: "0.25rem" }}><strong>{g.predicted_biallelic_LoF_clone_pct}%</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {biomniResult.lindelRanking.brunelloComparison?.length > 0 && (
                <div style={{ marginTop: "0.45rem", fontSize: "0.8rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "0.45rem 0.65rem" }}>
                  <strong>📚 Broad GPP Brunello Whole-Genome CRISPRko Library Cross-Reference ({biomniResult.lindelRanking.brunelloComparison[0].libraryGene} · Addgene #73178):</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.3rem" }}>
                    {biomniResult.lindelRanking.brunelloComparison.map(b => (
                      <span
                        key={b.spacer}
                        style={{
                          padding: "0.15rem 0.45rem",
                          borderRadius: "4px",
                          background: b.selectedInAssuredPair ? "#dcfce7" : "#ffffff",
                          border: b.selectedInAssuredPair ? "1px solid #16a34a" : "1px solid #fcd34d",
                        }}
                      >
                        <strong>Brunello #{b.brunelloRank}</strong> <code>{b.spacer}</code> (Exon {b.exon}{b.isoformCoverageLabel ? ` · ${b.isoformCoverageLabel}` : ""}, RS2 {b.ruleSet2}):{" "}
                        {b.lindelRank ? (
                          <span>
                            ASSURED Rank <strong>#{b.lindelRank}</strong> · Tier <code>{b.panelTier}</code> · LoF <strong>{b.predictedLofPct}%</strong>
                            {b.selectedInAssuredPair ? " ✅ Selected in ASSURED Pair" : !b.isCommonExon ? " ⚠ Non-common exon" : ""}
                          </span>
                        ) : (
                          <span><code>{b.panelTier}</code> (excluded by terminal exon NMD rule)</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </details>
          )}

          {biomniResult.screeningPower && (
            <p style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.88rem" }}>
              <strong>Clonal Screening Power ({biomniResult.screeningPower.mode}):</strong>{" "}
              Predicted biallelic clone rate ~<code>{biomniResult.screeningPower.predictedBiallelicClonePct}%</code> → Screen{" "}
              <strong>{biomniResult.screeningPower.recommendedClonesToScreen} clones</strong> ({biomniResult.screeningPower.plates96Well} × 96-well plate) for ≥95% probability of recovering ≥2 verified clones.
            </p>
          )}
        </div>
      )}
    </details>

    <details className="agent-details">
      <summary>Comparison settings · {enzymes.length} enzymes</summary>
      <fieldset disabled={Boolean(progress)}>
        <legend>Available enzymes</legend>
        <div className="agent-enzyme-options">{Object.values(ENZYMES).map(config => <label key={config.id}>
          <input type="checkbox" checked={enzymes.includes(config.id)} onChange={e => setEnzymes(prev => e.target.checked ? [...prev, config.id] : prev.filter(id => id !== config.id))} />
          {config.name} ({config.pam_pattern})
        </label>)}</div>
      </fieldset>
      <label className="agent-priority">Recommendation priority
        <select value={priority} disabled={Boolean(progress)} onChange={e => setPriority(e.target.value)}>
          {Object.entries(AGENT_PRIORITIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {project.editType === "ko" && <p>Knockout options are prioritized by predicted functional protein loss for both guides and their joint deletion, then coverage of annotated isoforms. SpCas9 guide-pair selection also uses Lindel when available. Geometry breaks later ties; Lindel percentages are not compared across enzymes.</p>}
      <p className="muted">Blocked or incomplete designs are excluded first. Activity scores are not compared across enzymes. Custom guides and previous risk acceptance are not reused.</p>
    </details>
    {inputError && <p className="muted">{inputError}</p>}
    <div className="agent-actions">
      <button type="button" className="btn btn-primary" disabled={Boolean(inputError || progress)} onClick={compare}>Compare enzymes and recommend</button>
      {progress && <button type="button" className="btn btn-secondary" onClick={cancel}>Cancel comparison</button>}
    </div>
    {progress && <p role="status" aria-live="polite">{progress.phase === "loading_model" ? "Loading Lindel for " : "Comparing "}{progress.enzyme} · {progress.completed}/{progress.total} completed</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {visible && <>
      <div className="agent-summary" aria-live="polite">
        <h3>{recommended.length ? `Recommended for design review: ${recommended.map(c => c.name).join(", ")}` : "No option can be recommended with these inputs"}</h3>
        {recommended.length > 1 && <p><strong>Equally supported options.</strong> These designs are tied; numbers indicate display order.</p>}
        {project.editType === "ko" && report?.requestKey === requestKey && recommended.length > 0 && !recommended.some(c => c.metrics?.knockoutFunctionalTier === "robust") && <p>No robust two-guide protein-loss plan was found among these options. Review the weaker assessments before proceeding.</p>}
        <p className="agent-review-note">Design review only. Experimental performance and genome-wide specificity remain unverified.</p>
        {report?.requestKey !== requestKey && <p className="muted">Saved recommendation. Compare again to evaluate changed settings.</p>}
      </div>
      <details className="agent-details">
        <summary>Compare {visible.candidates.length} options and choose a design</summary>
        <div className="agent-comparisons">{visible.candidates.map((candidate, index) => <article key={candidate.enzyme} className="agent-candidate">
          <h4>#{index + 1} {candidate.name} ({candidate.pam})</h4>
          {candidate.eligible && visible.candidates.filter(other => other.eligible && other.rank === candidate.rank).length > 1 && <p className="muted">Tied on design criteria</p>}
          <p><strong>{candidate.status === "unavailable" ? "No design" : candidate.status.toUpperCase()}</strong>{project.workflowRecommendation?.selectedEnzyme === candidate.enzyme ? " · Applied" : ""}</p>
          <p>{candidate.reasons[0]}</p>
          <details>
            <summary>{candidate.recommended ? "Why recommended and review items" : "Design findings and review items"}</summary>
            <ul>{candidate.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
            {candidate.warnings?.length > 0 && <ul>{candidate.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul>}
          </details>
          {candidate.result && <button type="button" className="btn btn-secondary" disabled={!candidate.eligible || Boolean(progress)} onClick={() => apply(candidate)}>Use {candidate.name} design</button>}
        </article>)}</div>
      </details>
      <details className="agent-details">
        <summary>Evidence, ranking details and export</summary>
        <strong>Evidence still needed before an experimental choice</strong>
        <ul>{agentEvidenceGaps(visible).map(text => <li key={text}>{text}</li>)}</ul>
        <p>Priority used: {AGENT_PRIORITIES[visible.priority] || visible.priority}. Compared: {visible.enzymesCompared?.map(id => ENZYMES[id]?.name || id).join(", ")}.</p>
        <p className="muted">Agent {visible.agentVersion} · enzyme config {visible.configVersion} · {new Date(visible.createdAt).toLocaleString()}</p>
        <ul>{visible.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>
        <button type="button" className="btn btn-secondary" onClick={download}>Download recommendation</button>
      </details>
    </>}
    {project.designResult && <details className="agent-details">
      <summary>Next steps for this experiment</summary>
      <p>{qcNextAction(project.qcResults)}</p>
      <ol>{workflowNextSteps(project.designResult).map((text, i) => <li key={i}>{text}</li>)}</ol>
    </details>}
  </section>;
}
