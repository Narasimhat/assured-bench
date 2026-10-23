import React from "react";

export function GuideAlternatives({ result }) {
  const search = result?.guideAlternatives;
  if (!search) return null;
  const candidates = search.candidates || [];
  return (
    <section aria-label="Alternative guide RNAs" style={{ margin: "1rem 0" }}>
      <h3>Alternative gRNAs within ±{search.radius} bp</h3>
      <p style={{ fontSize: "0.85rem", margin: "0.5rem 0" }}>
        {result.gs.length} selected guide{result.gs.length === 1 ? "" : "s"} from the {search.selectedWindow} bp search window. {search.note}
      </p>
      {candidates.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead><tr>{["Spacer (5′ → 3′)", "PAM", "Strand", "Cut distance", "Protection with current donor", "CFD residual"].map(label => <th key={label} style={{ padding: 8, textAlign: "left", borderBottom: "1px solid #64748b" }}>{label}</th>)}</tr></thead>
            <tbody>{candidates.map(g => (
              <tr key={`${g.sp}:${g.str}:${g.cut}`}>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{g.sp}</td>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{g.pm}</td>
                <td style={{ padding: 8 }}>{g.str}</td>
                <td style={{ padding: 8 }}>{Math.abs(g.d)} bp {g.d < 0 ? "upstream" : g.d > 0 ? "downstream" : "at insertion"}</td>
                <td style={{ padding: 8 }} title={g.reason}><strong>{g.protection}</strong><div style={{ fontSize: "0.75rem" }}>{g.byInsertion ? "Insertion disrupts target" : g.protection === "strong" ? "Blocking substitutions" : "Review donor protection"}</div></td>
                <td style={{ padding: 8 }}>{g.byInsertion ? "Target disrupted by insertion" : Number.isFinite(g.cfd) ? g.cfd.toFixed(4) : "Not assessed"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>No additional candidates passed the existing PAM and spacer filters within ±{search.radius} bp.</p>}
    </section>
  );
}
