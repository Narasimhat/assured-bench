import React, { useState } from "react";
import { REGULATORY_CONTEXT_CATALOG, BROAD_CONTEXT_IDS, regulatoryContextCoverage, buildRegulatoryContextPlan } from "../../services/regulatoryContexts.js";

export function RegulatoryContextPanel({ project, onUpdateProject }) {
  const saved = project.regulatoryContextPlan;
  const [selected, setSelected] = useState(() => saved?.contexts?.map(c => c.id) || BROAD_CONTEXT_IDS);
  const [pscLine, setPscLine] = useState(saved?.experimentalContext?.pscLine || "");
  const [notes, setNotes] = useState(saved?.experimentalContext?.derivativeNotes || "");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const contexts = REGULATORY_CONTEXT_CATALOG.contexts.filter(c => showAll || selected.includes(c.id));
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  const makePlan = () => buildRegulatoryContextPlan({ contextIds: selected, pscLine, derivativeNotes: notes });
  const savePanel = () => {
    try { onUpdateProject({ regulatoryContextPlan: makePlan(), regulatoryReview: null }); setError(""); }
    catch (e) { setError(e.message); }
  };
  const exportPlan = () => {
    try {
      const plan = makePlan();
      const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");link.href = url;link.download = "assured-regulatory-context-plan.json";link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);setError("");
    } catch (e) { setError(e.message); }
  };
  return <section className="card regulatory-context-panel" aria-label="AlphaGenome regulatory study panel">
    <div className="card-title"><span>AlphaGenome · regulatory study panel</span><span className="muted" style={{ fontSize: "0.8rem", fontWeight: 400 }}>{selected.length} model contexts</span></div>
    <p>Compare the starting pluripotent state with a broad panel of derivatives. Each cell context remains a separate comparison, with its available assays recorded.</p>
    <p className="regulatory-plan-status"><strong>{saved ? "Panel configured" : "Draft panel"} · predictions not run.</strong> This step prepares the study; it does not score edits, rank guides or simulate differentiation.</p>
    <div className="regulatory-context-fields">
      <label>Your experimental PSC line (optional)<input aria-label="Experimental PSC line" value={pscLine} maxLength={200} onChange={e => setPscLine(e.target.value)} placeholder="e.g. your iPSC line or clone" /></label>
      <label>Derivative stages / experimental context (optional)<textarea aria-label="Derivative context notes" value={notes} maxLength={2000} rows={2} onChange={e => setNotes(e.target.value)} placeholder="Record differentiation protocols, maturation stages or context gaps to review." /></label>
    </div>
    <div className="report-actions" style={{ margin: "0.75rem 0" }}>
      <button type="button" className="btn btn-secondary" onClick={() => setSelected([...BROAD_CONTEXT_IDS])}>Use broad panel</button>
      <button type="button" className="btn btn-secondary" onClick={() => setShowAll(value => !value)}>{showAll ? "Show selected contexts" : "Add or change model contexts"}</button>
    </div>
    <div style={{ overflowX: "auto" }}><table className="regulatory-context-table"><caption>Model coverage snapshot · {REGULATORY_CONTEXT_CATALOG.retrievedAt.slice(0, 10)} · human {REGULATORY_CONTEXT_CATALOG.modelVersion}</caption>
      <thead><tr><th>Model context</th><th>Interpretation</th><th>RNA</th><th>Cell-specific splicing</th><th>Accessibility</th><th>Other tracks</th></tr></thead>
      <tbody>{contexts.map(context => {
        const coverage = regulatoryContextCoverage(context);
        return <tr key={context.id}>
          <td><label><input type="checkbox" checked={selected.includes(context.id)} onChange={() => toggle(context.id)} /> {context.label}</label><small>{context.lineage} · {context.ontology}</small><small>Source labels: {context.biosampleNames.join(" / ") || "not recorded"}</small></td>
          <td>{context.match === "reference" ? "PSC reference" : context.match === "tissue-proxy" ? "Tissue proxy" : "Lineage proxy"}<small>Experimental match unverified</small></td>
          <td>{coverage.expression ? "Available" : "Unavailable"}</td><td>{coverage.splicing ? "Usage / junction tracks" : "Unavailable"}</td>
          <td>{coverage.accessibility.join(" / ") || "Unavailable"}</td><td>{[...coverage.regulatoryMarks, ...(coverage.contacts ? ["CONTACT_MAPS"] : [])].join(" / ") || "Unavailable"}</td>
        </tr>;
      })}</tbody></table></div>
    <p className="muted" style={{ fontSize: "0.8rem" }}>Assays can use different source samples or cell states within one ontology. These are model reference contexts, not verified matches to your cells or differentiation protocol. Shared splice-site predictions are not counted as cell-specific splicing coverage. Unavailable tracks remain unavailable; no substitute context is chosen automatically.</p>
    <div className="report-actions"><button type="button" className="btn btn-primary" onClick={savePanel}>Use this study panel</button><button type="button" className="btn btn-secondary" onClick={exportPlan}>Export context plan</button></div>
    <p className="muted" style={{ fontSize: "0.8rem" }}>Save your experiment to retain this panel between sessions.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
