import React, { useEffect, useRef, useState } from "react";
import { ENZYMES } from "../../engine/design/enzymeConfig.js";
import { buildDesignSchemeSvg, buildDesignSchemeCaption } from "../../engine/design/designScheme.js";
import { AGENT_PRIORITIES, agentRequest, agentAudit, isAgentAudit, workflowNextSteps, qcNextAction } from "../../services/workflowAgent.js";

export function WorkflowAgent({ project, onUpdateProject }) {
  const [enzymes, setEnzymes] = useState(() => Object.keys(ENZYMES));
  const [priority, setPriority] = useState("balanced");
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const worker = useRef(null);
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
    onUpdateProject({
      options: { ...request.options, enzyme: candidate.enzyme, spacerLength: config.spacer_len.default,
        directRepeat: config.direct_repeat || "", repeatVerified: false, repeatSource: "", customGuides: [] },
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
  return <section className="card workflow-agent" aria-labelledby="workflow-agent-title">
    <h2 id="workflow-agent-title">Workflow agent</h2>
    <p>Compare the enzymes available in your lab for this modification. The agent runs the design engine and explains its ranking. These are rule-based recommendations, not predictions of editing success.</p>
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
    {project.editType === "ko" && <p>For knockout, the agent compares nominal frameshift and exon-skipping evidence, then primer checks. Cut-proximity and blocking-change priorities apply to HDR edits. Repair outcomes can differ from the nominal junction.</p>}
    <p className="muted">All priorities first exclude blocked or incomplete designs and respect the existing release gates. Activity scores are not compared across enzymes. Custom guides and prior risk acceptance are not reused.</p>
    {inputError && <p className="note">{inputError}</p>}
    <div className="agent-actions">
      <button type="button" className="btn btn-primary" disabled={Boolean(inputError || progress)} onClick={compare}>Compare enzymes and recommend</button>
      {progress && <button type="button" className="btn btn-secondary" onClick={cancel}>Cancel comparison</button>}
      {visible && <button type="button" className="btn btn-secondary" onClick={download}>Download recommendation</button>}
    </div>
    {progress && <p role="status" aria-live="polite">Comparing {progress.enzyme} · {progress.completed}/{progress.total} completed</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {visible && <>
      <h3>{recommended.length ? `Best supported under these rules: ${recommended.map(c => c.name).join(", ")}` : "No option can be recommended with these inputs"}</h3>
      {recommended.length > 1 && <p>These options are tied on the recorded design criteria. The agent cannot distinguish their experimental performance.</p>}
      {report?.requestKey !== requestKey && <p className="note">Saved record for the applied design. Compare again to evaluate the current enzyme selection and priority.</p>}
      <p>Priority used: {AGENT_PRIORITIES[visible.priority] || visible.priority}. Compared: {visible.enzymesCompared?.map(id => ENZYMES[id]?.name || id).join(", ")}.</p>
      <p className="muted">Agent {visible.agentVersion} · enzyme config {visible.configVersion} · {new Date(visible.createdAt).toLocaleString()}</p>
      <div className="agent-comparisons">{visible.candidates.map(candidate => <article key={candidate.enzyme} className="agent-candidate">
        <h4>{candidate.eligible ? `#${candidate.rank} ` : ""}{candidate.name} ({candidate.pam})</h4>
        <p><strong>{candidate.status === "unavailable" ? "No design" : candidate.status.toUpperCase()}</strong>{project.workflowRecommendation?.selectedEnzyme === candidate.enzyme ? " · Applied to this experiment" : ""}</p>
        <ul>{candidate.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
        {candidate.warnings?.length > 0 && <details><summary>{candidate.warnings.length} review item(s)</summary><ul>{candidate.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul></details>}
        {candidate.result && <button type="button" className="btn btn-secondary" disabled={!candidate.eligible || Boolean(progress)} onClick={() => apply(candidate)}>Use {candidate.name} design</button>}
      </article>)}</div>
      <details><summary>What this recommendation can and cannot establish</summary><ul>{visible.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></details>
    </>}
    <h3>Next steps for this experiment</h3>
    <p>{qcNextAction(project.qcResults)}</p>
    <ol>{workflowNextSteps(project.designResult).map((text, i) => <li key={i}>{text}</li>)}</ol>
  </section>;
}
