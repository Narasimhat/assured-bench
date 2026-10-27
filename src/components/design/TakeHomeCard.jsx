import React from "react";
import { ArrowRight, Download, FileText } from "lucide-react";

const TONE = {
  ok: { bg: "#dcfce7", fg: "#166534" },
  warn: { bg: "#fef3c7", fg: "#92400e" },
  bad: { bg: "#fee2e2", fg: "#991b1b" },
  info: { bg: "#e0f2fe", fg: "#075985" },
};

/**
 * The take-home message of a design (src/services/takeHome.js): what was designed, what to expect, what to watch and what to do next.
 * Everything else about the design is behind it, one click away.
 */
export function TakeHomeCard({
  takeHome,
  onProceedToOrder,
  onDownloadReport,
  onDownloadOffTarget,
  onChoosePair,
  showActions = true,
  showProceed = true,
  proceedLabel = "Proceed to Order",
  leadingAction = null,
}) {
  if (!takeHome) return null;
  const status = TONE[takeHome.status.tone] || TONE.warn;
  return (
    <section id={showActions ? "bench-take-home" : undefined} aria-label="Take-home" className="card" style={{ borderLeft: `6px solid ${status.fg}` }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ padding: "0.15rem 0.6rem", borderRadius: 999, background: status.bg, color: status.fg, fontWeight: 700, fontSize: "0.8rem" }}>{takeHome.status.label}</span>
        {takeHome.status.detail && <span className="muted" style={{ fontSize: "0.82rem" }}>{takeHome.status.detail}</span>}
      </div>
      <h2 style={{ fontSize: "1.15rem", margin: "0.6rem 0 0.3rem", lineHeight: 1.35 }}>{takeHome.headline}</h2>
      <p style={{ margin: "0 0 0.8rem", fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 }}>{takeHome.bottomLine}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.6rem", marginBottom: "0.9rem" }}>
        {takeHome.facts.map((fact, i) => (
          <div key={i} style={{ padding: "0.5rem 0.7rem", borderRadius: 8, background: "var(--bg-muted, #f8fafc)", border: "1px solid var(--border-light, #e5e7eb)", gridColumn: fact.label === "Guides" ? "1 / -1" : undefined }}>
            <div className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>{fact.label}</div>
            <div style={{ fontWeight: 700, fontSize: fact.label === "Guides" ? "0.9rem" : "1.05rem", fontFamily: fact.label === "Guides" ? "monospace" : undefined, overflowWrap: "anywhere" }}>{fact.value}</div>
            {fact.note && <div className="muted" style={{ fontSize: "0.78rem" }}>{fact.note}</div>}
          </div>
        ))}
      </div>

      {takeHome.watch.length > 0 && (
        <div style={{ marginBottom: "0.9rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.25rem" }}>Watch</div>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.9rem", lineHeight: 1.45 }}>
            {takeHome.watch.map((w, i) => <li key={i} style={{ color: w.tone === "bad" ? TONE.bad.fg : undefined }}>{w.text}</li>)}
          </ul>
          {takeHome.watchMore > 0 && <div className="muted" style={{ fontSize: "0.8rem" }}>{takeHome.watchMore} more in the details below.</div>}
        </div>
      )}

      <div style={{ marginBottom: "0.9rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.25rem" }}>Next</div>
        <ol style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.9rem", lineHeight: 1.45 }}>
          {takeHome.nextSteps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </div>

      {showActions && <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {leadingAction}
        {showProceed && onProceedToOrder && (
          <button className="btn btn-primary" onClick={onProceedToOrder}>
            <span>{proceedLabel}</span>
            <ArrowRight size={16} />
          </button>
        )}
        {onChoosePair && <button className="btn btn-secondary" onClick={onChoosePair}><span>Choose a different pair</span></button>}
        <button className="btn btn-secondary" onClick={onDownloadReport}><FileText size={16} /><span>Download report</span></button>
        <button className="btn btn-secondary" onClick={onDownloadOffTarget} title="Input file for Cas-OFFinder. Bench does not search the genome for off-targets; run this against the genome of your line."><Download size={16} /><span>Cas-OFFinder input</span></button>
      </div>}
    </section>
  );
}
