import React, { useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { TakeHomeCard } from "./TakeHomeCard.jsx";
import { getEnzyme } from "../../engine/design/enzymeConfig.js";
import { getProjectTypeMeta } from "../../engine/design/reportHtml.js";

const TYPE_FALLBACK = {
  "genomic-snv": { label: "Genomic SNP" },
};

function editTypeLabel(type) {
  if (TYPE_FALLBACK[type]) return TYPE_FALLBACK[type].label;
  return getProjectTypeMeta(type)?.label || type || "Design";
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary"
      style={{ padding: "0.2rem 0.55rem", fontSize: "0.75rem" }}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Copy sequence"
    >
      {copied ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ReagentGroup({ title, count, rows, empty }) {
  return (
    <div className="design-result-reagent-group">
      <div className="design-result-reagent-heading">
        <span>{title}</span>
        <span className="muted">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{empty}</p>
      ) : (
        <ul className="design-result-reagent-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="design-result-reagent-meta">
                <strong>{row.name}</strong>
                {row.note && <span className="muted">{row.note}</span>}
              </div>
              <code className="mono design-result-sequence">{row.sequence}</code>
              <CopyButton text={row.sequence} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Product-first surface after a design succeeds: identity, take-home, orderable reagents, one continue path.
 * Process tools (full report, enzyme compare, guide picker) stay in children, demoted below.
 */
export function DesignResult({
  currentProject,
  designResult,
  takeHome,
  reagents,
  onProceedToOrder,
  onEditDesign,
  onDownloadReport,
  onDownloadOffTarget,
  onChoosePair,
  children,
}) {
  if (!designResult) return null;

  const gene = reagents?.gene || designResult.gene || currentProject?.gene || "TARGET";
  const enzymeId = designResult.enzyme?.id || currentProject?.options?.enzyme || "spcas9";
  const enzymeName = getEnzyme(enzymeId)?.name || enzymeId;
  const typeLabel = editTypeLabel(designResult.type || currentProject?.editType);
  const status = designResult.procurement?.status || "review";
  const blockers = designResult.procurement?.blockers || [];

  const proceedLabel =
    status === "blocked" ? null : "Review & export order";
  const primaryIsFix = status === "blocked";

  return (
    <div className="design-result" id="bench-design-result">
      <div className="design-result-identity">
        <div>
          <p className="design-result-kicker">Your design</p>
          <h2 className="design-result-title">
            {gene}
            <span className="muted"> · {typeLabel} · {enzymeName}</span>
          </h2>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onEditDesign}>
          <Pencil size={16} />
          <span>Edit design</span>
        </button>
      </div>

      <TakeHomeCard
        takeHome={takeHome}
        onProceedToOrder={proceedLabel ? onProceedToOrder : undefined}
        proceedLabel={proceedLabel || "Proceed to Order"}
        showProceed={!primaryIsFix && Boolean(proceedLabel)}
        onDownloadReport={onDownloadReport}
        onDownloadOffTarget={onDownloadOffTarget}
        onChoosePair={onChoosePair}
        leadingAction={
          primaryIsFix ? (
            <button type="button" className="btn btn-primary" onClick={onEditDesign}>
              <Pencil size={16} />
              <span>Fix design</span>
            </button>
          ) : null
        }
      />

      {(status === "blocked" && blockers.length > 0) && (
        <div className="design-result-gates" role="status">
          {blockers.slice(0, 3).map((text, i) => (
            <p key={`b${i}`} className="design-result-gate design-result-gate-bad">{text}</p>
          ))}
        </div>
      )}

      <section className="card design-result-reagents" aria-label="Selected reagents">
        <div className="card-title" style={{ marginBottom: "0.75rem" }}>
          <span>Selected reagents</span>
          <span className="muted" style={{ fontWeight: 500, fontSize: "0.85rem" }}>
            {reagents.counts.guides} guide{reagents.counts.guides === 1 ? "" : "s"}
            {" · "}
            {reagents.counts.donors} donor{reagents.counts.donors === 1 ? "" : "s"}
            {" · "}
            {reagents.counts.primers} primer{reagents.counts.primers === 1 ? "" : "s"}
          </span>
        </div>

        <div className="design-result-reagent-grid">
          <ReagentGroup
            title="Guide RNAs"
            count={`${reagents.counts.guides}`}
            rows={reagents.guides}
            empty="No guides in this design."
          />
          <ReagentGroup
            title="Donors"
            count={`${reagents.counts.donors}`}
            rows={reagents.donors}
            empty="None (knockout / excision)."
          />
          <ReagentGroup
            title="Primers"
            count={`${reagents.counts.primers}`}
            rows={reagents.primers}
            empty="No screening primers yet."
          />
        </div>

      </section>

      {children}
    </div>
  );
}
