import React, { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";

export function GuideAlternatives({ result, onSelectAlternative }) {
  const [copiedSp, setCopiedSp] = useState(null);
  const search = result?.guideAlternatives;
  if (!search) return null;
  const candidates = search.candidates || [];

  const handleCopy = (sp) => {
    navigator.clipboard.writeText(sp);
    setCopiedSp(sp);
    setTimeout(() => setCopiedSp(null), 1800);
  };

  return (
    <section aria-label="Alternative guide RNAs" style={{ margin: "0.5rem 0" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>Alternative gRNAs within &plusmn;{search.radius} bp</h3>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.35rem 0 0.75rem" }}>
        {result.gs.length} selected guide{result.gs.length === 1 ? "" : "s"} from the {search.selectedWindow} bp search window. {search.note}
      </p>
      {candidates.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr>
                {["Spacer (5\u2032 \u2192 3\u2032)", "PAM", "Strand", "GC %", "Cut distance", "Protection with current donor", "CFD residual", "Actions"].map(label => (
                  <th key={label} style={{ padding: 8, textAlign: "left" }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map(g => (
                <tr key={`${g.sp}:${g.str}:${g.cut}`}>
                  <td style={{ padding: 8, fontFamily: "monospace", color: "var(--primary)", fontWeight: 600 }}>{g.sp}</td>
                  <td style={{ padding: 8, fontFamily: "monospace", color: "var(--warning)" }}>{g.pm}</td>
                  <td style={{ padding: 8 }}>{g.str}</td>
                  <td style={{ padding: 8 }}>{g.gc != null ? `${g.gc}%` : "\u2014"}</td>
                  <td style={{ padding: 8 }}>{Math.abs(g.d)} bp {g.d < 0 ? "upstream" : g.d > 0 ? "downstream" : "at insertion"}</td>
                  <td style={{ padding: 8 }} title={g.reason}>
                    <span className={`badge ${g.protection === "strong" ? "badge-ready" : "badge-review"}`} style={{ fontSize: "0.75rem" }}>
                      {g.protection}
                    </span>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                      {g.byInsertion ? "Insertion disrupts target" : g.protection === "strong" ? "Blocking substitutions" : "Review donor protection"}
                    </div>
                  </td>
                  <td style={{ padding: 8, fontFamily: "monospace" }}>
                    {g.byInsertion ? "Disrupted by insert" : Number.isFinite(g.cfd) ? g.cfd.toFixed(4) : "Not assessed"}
                  </td>
                  <td style={{ padding: 8 }}>
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem" }}
                        onClick={() => handleCopy(g.sp)}
                        title="Copy 20-nt protospacer"
                      >
                        {copiedSp === g.sp ? <Check size={13} style={{ color: "var(--success)" }} /> : <Copy size={13} />}
                        <span>{copiedSp === g.sp ? "Copied" : "Copy"}</span>
                      </button>
                      {onSelectAlternative && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
                          onClick={() => onSelectAlternative(g.sp)}
                          title="Promote this candidate to primary gRNA and regenerate donor blocking mutations"
                        >
                          <RefreshCw size={13} />
                          <span>Use Guide</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          No additional candidates passed the existing PAM and spacer filters within &plusmn;{search.radius} bp.
        </p>
      )}
    </section>
  );
}
