import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { previewKoPair } from "../../engine/design/designEngine.js";

const fmt = (value, unit = "%") => (Number.isFinite(value) ? `${value}${unit}` : "\u2014");
const OTHER_ISOFORMS_NOTE = "Share of this guide's predicted repair outcomes after which at least one other annotated isoform of the gene is still predicted to make protein (in-frame change, no effect on that isoform, or a stop so close to its start that translation can restart). Not the share of isoforms.";
const TIER_NOTE = {
  robust: "Frameshifts in this guide trigger nonsense-mediated decay in every annotated isoform",
  marginal: "Frameshifts are borderline for nonsense-mediated decay",
  truncation: "Frameshifts truncate the protein but may escape decay",
  escape: "Frameshifts are expected to escape decay or leave a functional protein",
};

/**
 * Lists the guides the selector ranked, with the repair outcome predicted for each, and lets the user choose two of them. The pair is previewed
 * (deletion between the cuts, frame, tier, predicted loss of function) before the design and report are regenerated for it.
 */
export function KoGuidePicker({ result, genbankRaw, geneSymbol, onUsePair, onUseRecommended, busy = false }) {
  const picker = result?.koPicker;
  const pickerRows = picker?.rows || [];
  const current = useMemo(() => (result?.gs || []).map(guide => guide.sp), [result]);
  const [selected, setSelected] = useState(current);
  const [sortBy, setSortBy] = useState("selector");
  useEffect(() => { setSelected(current); }, [current.join("|")]);
  const rowOf = spacer => pickerRows.find(row => row.spacer === spacer);
  const sorted = useMemo(() => {
    const rows = [...pickerRows];
    if (sortBy === "lof") rows.sort((a, b) => (b.effectiveLofPct ?? -1) - (a.effectiveLofPct ?? -1) || a.rank - b.rank);
    return rows;
  }, [picker, sortBy]);
  const picks = selected.map(rowOf).filter(Boolean);
  const preview = useMemo(() => (picks.length === 2 ? previewKoPair(genbankRaw, picks, { expectedGene: geneSymbol }) : null), [picks.map(p => p.spacer).join("|"), genbankRaw, geneSymbol]);
  if (!pickerRows.length) return null;

  const recommended = result.koPairChoice?.recommended?.pair || null;
  const unchanged = selected.length === current.length && selected.every(spacer => current.includes(spacer));
  const toggle = spacer => setSelected(list => (list.includes(spacer) ? list.filter(x => x !== spacer) : [...list, spacer].slice(-2)));
  const hasModel = Boolean(picker.outcomeModel);
  const hasCoverage = pickerRows.some(row => Number.isFinite(row.isoformCoveragePct));
  // with one annotated coding sequence there is no other isoform to evaluate: the share is not 0%, it was not computed
  const otherIsoforms = picker.isoformsEvaluated == null ? true : picker.isoformsEvaluated > 1;
  const recommendedRows = recommended ? recommended.map(rowOf) : [];
  const recommendedMin = recommendedRows.length === 2 && recommendedRows.every(r => r && Number.isFinite(r.lofPct)) ? Math.min(...recommendedRows.map(r => r.lofPct)) : null;

  return (
    <section aria-label="Choose the guide pair" style={{ margin: "0.25rem 0" }}>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
        {picker.listed} of {picker.eligible} eligible guides ({picker.scanned} scanned), in the selector&apos;s order: functional tier, isoform escape, then
        {hasModel ? " predicted loss of function after the GC penalty" : " (no repair-outcome model for this enzyme, so no predicted loss of function)"}.
        {hasModel && <> Loss of function is the Lindel-predicted share of repair outcomes that remove the protein, given a cut; cutting efficiency is not modelled. The pair is the
        selector&apos;s joint choice, so its guides need not be the two top rows.</>}
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
        <label>Sort by{" "}
          <select value={sortBy} onChange={event => setSortBy(event.target.value)} aria-label="Sort guides">
            <option value="selector">selector rank</option>
            {hasModel && <option value="lof">predicted loss of function (after GC penalty)</option>}
          </select>
        </label>
        <span style={{ color: "var(--text-muted)" }}>Tick two guides.</span>
      </div>
      <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg-card, #fff)" }}>
            <tr>
              {["", "Rank", "Spacer (5\u2032 \u2192 3\u2032)", "Strand", "Cut (coding exon + nt)", "GC", "Tier", "Predicted LoF", "Frameshift", "+1 insertion", "In-frame", "Other isoforms left intact", ...(hasCoverage ? ["Annotated transcripts with the cut"] : []), ""].map((label, i) => (
                <th key={i} style={{ padding: 6, textAlign: "left", whiteSpace: "nowrap" }} title={label === "Other isoforms left intact" ? OTHER_ISOFORMS_NOTE : undefined}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => {
              const on = selected.includes(row.spacer);
              return (
                <tr key={`${row.spacer}:${row.strand}:${row.cut}`} onClick={() => toggle(row.spacer)} style={{ cursor: "pointer", background: on ? "rgba(37,99,235,0.08)" : undefined }}>
                  <td style={{ padding: 6 }}><input type="checkbox" checked={on} onChange={() => toggle(row.spacer)} aria-label={`Choose ${row.spacer}`} /></td>
                  <td style={{ padding: 6 }}>#{row.rank}</td>
                  <td style={{ padding: 6, fontFamily: "monospace", fontWeight: 600, color: "var(--primary)" }}>{row.spacer} <span style={{ color: "var(--warning)" }}>{row.pam}</span></td>
                  <td style={{ padding: 6 }}>{row.strand}</td>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }} title="Coding exon: counted from the first exon of the coding sequence, not the annotated transcript exon number">Exon {row.exon} +{row.offsetInExon}</td>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>{row.gc}%{row.gcPenaltyPts ? <span className="muted" title="Points subtracted from the predicted loss of function for ranking"> (&minus;{row.gcPenaltyPts})</span> : null}</td>
                  <td style={{ padding: 6 }} title={TIER_NOTE[row.tier]}>{row.tier}</td>
                  <td style={{ padding: 6 }}><strong>{fmt(row.lofPct)}</strong></td>
                  <td style={{ padding: 6 }}>{fmt(row.frameshiftPct)}</td>
                  <td style={{ padding: 6 }}>{fmt(row.plus1Pct)}</td>
                  <td style={{ padding: 6 }}>{fmt(row.inframePct)}</td>
                  <td style={{ padding: 6 }} title={otherIsoforms ? OTHER_ISOFORMS_NOTE : "Only one coding sequence is annotated in this reference, so no other isoform was evaluated."}>{otherIsoforms ? fmt(row.otherIsoformNotDisruptedPct) : "\u2014"}</td>
                  {hasCoverage && <td style={{ padding: 6 }} title="Share of the annotated RefSeq and Ensembl coding transcripts whose coding sequence contains this cut (the smaller of the two)">{fmt(row.isoformCoveragePct)}</td>}
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>
                    {current.includes(row.spacer) && <span className="badge badge-ready" style={{ fontSize: "0.7rem" }}>in design</span>}{" "}
                    {recommended?.includes(row.spacer) && <span className="badge badge-review" style={{ fontSize: "0.7rem" }}>recommended</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
        <strong>Other isoforms left intact:</strong> {OTHER_ISOFORMS_NOTE}
        {!otherIsoforms && " Here only one coding sequence is annotated, so the column is not computed (shown as a dash); the transcript column and the Co-Scientist panel check the cut against RefSeq and Ensembl transcripts instead."}
      </p>

      <div role="status" aria-live="polite" style={{ marginTop: "0.75rem", padding: "0.6rem 0.8rem", borderRadius: 8, border: "1px solid var(--border, #cbd5e1)", fontSize: "0.85rem" }}>
        {!preview && <span style={{ color: "var(--text-muted)" }}>Choose two guides to see the deletion between them and the predicted outcome.</span>}
        {preview && !preview.ok && <span style={{ color: "var(--danger, #b91c1c)" }}>{preview.errors.join(" ")}</span>}
        {preview?.ok && (
          <div>
            <div>
              <strong>Deletion between the cuts: {preview.spacing} bp</strong> ({preview.frameshiftPredicted ? "shifts the frame" : "keeps the frame"}, mod 3 = {preview.deletionMod3}) &middot; pair tier <strong>{preview.tier}</strong>
              {" "}(deletion alone: {preview.betweenTier}, {preview.betweenClass})
            </div>
            <div>
              Weaker guide predicted LoF <strong>{fmt(preview.minLofPct)}</strong>
              {preview.expectedBiallelicPct != null && <> &rarr; about {preview.expectedBiallelicPct}% of cells with both alleles lost if every cell is edited</>}
              {recommendedMin != null && !unchanged && <> &middot; the selector&apos;s pair: {fmt(recommendedMin)}</>}
            </div>
            {preview.warnings.map((warning, i) => <div key={i} style={{ color: "var(--warning, #b45309)" }}>{warning}</div>)}
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
          <button type="button" className="btn btn-primary" disabled={busy || !preview?.ok || unchanged} onClick={() => onUsePair(selected)} style={{ fontSize: "0.8rem" }}>
            <RefreshCw size={14} /> <span>{busy ? "Regenerating\u2026" : "Use this pair \u2014 regenerate design and report"}</span>
          </button>
          {result.koPairChoice?.source === "user" && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onUseRecommended()} style={{ fontSize: "0.8rem" }}>
              <RotateCcw size={14} /> <span>Back to the selector&apos;s pair</span>
            </button>
          )}
        </div>
        {result.koPairChoice?.source === "user" && <div className="muted" style={{ marginTop: "0.4rem" }}>The current design uses a pair you chose; the report says so and names the selector&apos;s recommendation.</div>}
      </div>
    </section>
  );
}
