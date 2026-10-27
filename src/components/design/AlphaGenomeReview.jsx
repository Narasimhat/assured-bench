import React, { useEffect, useRef, useState } from "react";
import {
  ALPHAGENOME_RESEARCH_TISSUES,
  alphaGenomeMapping,
  buildAlphaGenomeRequest,
  compareDonorBlockerLayouts,
  validateAlphaGenomeReport,
} from "../../services/alphaGenomeReview.js";

function formFromSaved(saved, project) {
  const options = saved?.options;
  const request = saved?.request;
  const mapping = alphaGenomeMapping(project);
  const donors = project?.designResult?.os || [];
  let donorIndex = Number.isInteger(options?.donorIndex) ? options.donorIndex : 0;
  if (request?.donor && donors.length) {
    const byName = donors.findIndex((d) => d.n === request.donor);
    if (byName >= 0) donorIndex = byName;
  }
  return {
    chromosome: options?.chromosome != null
      ? String(options.chromosome)
      : (request?.chromosome ? String(request.chromosome).replace(/^chr/i, "") : (mapping?.chromosome || "")),
    referenceStart: options?.referenceStart != null
      ? String(options.referenceStart)
      : (request?.reference?.start != null ? String(request.reference.start) : (mapping?.referenceStart != null ? String(mapping.referenceStart) : "")),
    orientation: options?.orientation != null
      ? String(options.orientation)
      : (mapping?.orientation != null ? String(mapping.orientation) : ""),
    ontologyTerm: options?.ontologyTerm || request?.ontologyTerms?.[0] || ALPHAGENOME_RESEARCH_TISSUES[0]?.id || "",
    sequenceLength: options?.sequenceLength || request?.sequenceLength || 16384,
    donorIndex,
    confirmed: Boolean(saved?.report && saved?.request),
  };
}

function reviewFingerprint({ designResult, genbankRaw, chromosome, referenceStart, orientation, ontologyTerm, sequenceLength, donorIndex, confirmed }) {
  return JSON.stringify({
    designType: designResult?.type || null,
    designGene: designResult?.gene || null,
    donorCount: designResult?.os?.length || 0,
    donorName: designResult?.os?.[donorIndex]?.n || null,
    genbankLen: String(genbankRaw || "").length,
    chromosome: String(chromosome || ""),
    referenceStart: String(referenceStart || ""),
    orientation: String(orientation || ""),
    ontologyTerm: String(ontologyTerm || ""),
    sequenceLength: Number(sequenceLength) || 0,
    donorIndex: Number(donorIndex) || 0,
    confirmed: Boolean(confirmed),
  });
}

/** Research-only AlphaGenome donor review. Does not gate design release; API key stays local. */
export function AlphaGenomeReview({ project, onUpdateProject }) {
  const saved = project?.alphaGenomeReview;
  const initial = formFromSaved(saved, project);
  const [chromosome, setChromosome] = useState(initial.chromosome);
  const [referenceStart, setReferenceStart] = useState(initial.referenceStart);
  const [orientation, setOrientation] = useState(initial.orientation);
  const [ontologyTerm, setOntologyTerm] = useState(initial.ontologyTerm);
  const [sequenceLength, setSequenceLength] = useState(initial.sequenceLength);
  const [donorIndex, setDonorIndex] = useState(initial.donorIndex);
  const [compareIndexB, setCompareIndexB] = useState(initial.donorIndex === 0 ? 1 : 0);
  const [confirmed, setConfirmed] = useState(initial.confirmed);
  const [report, setReport] = useState(saved?.report || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const lastFingerprint = useRef(null);
  const options = { assembly: "GRCh38", chromosome, referenceStart: Number(referenceStart), orientation: Number(orientation), ontologyTerm: ontologyTerm.trim(), sequenceLength, donorIndex, mappingConfirmed: confirmed };

  useEffect(() => {
    const next = formFromSaved(project?.alphaGenomeReview, project);
    setChromosome(next.chromosome);
    setReferenceStart(next.referenceStart);
    setOrientation(next.orientation);
    setOntologyTerm(next.ontologyTerm);
    setSequenceLength(next.sequenceLength);
    setDonorIndex(next.donorIndex);
    setCompareIndexB(next.donorIndex === 0 ? 1 : 0);
    setConfirmed(next.confirmed);
    setReport(project?.alphaGenomeReview?.report || null);
    setError("");
    setBusy(false);
    lastFingerprint.current = null;
  }, [project.id, project.genbankRaw]);

  useEffect(() => {
    if (project?.alphaGenomeReview?.report) setReport(project.alphaGenomeReview.report);
  }, [project?.alphaGenomeReview?.report]);

  useEffect(() => {
    const fingerprint = reviewFingerprint({
      designResult: project.designResult,
      genbankRaw: project.genbankRaw,
      chromosome,
      referenceStart,
      orientation,
      ontologyTerm,
      sequenceLength,
      donorIndex,
      confirmed,
    });
    if (lastFingerprint.current == null) {
      lastFingerprint.current = fingerprint;
      return;
    }
    if (lastFingerprint.current === fingerprint) return;
    lastFingerprint.current = fingerprint;
    generation.current += 1;
    setReport(null);
    setError("");
    setBusy(false);
    if (onUpdateProject && project?.alphaGenomeReview) onUpdateProject({ alphaGenomeReview: null });
  }, [project.designResult, project.genbankRaw, chromosome, referenceStart, orientation, ontologyTerm, sequenceLength, donorIndex, confirmed, onUpdateProject, project?.alphaGenomeReview]);

  const detectedMapping = alphaGenomeMapping(project);
  const mappingAutoFilled = Boolean(
    detectedMapping?.grch38
    && String(detectedMapping.chromosome) === String(chromosome)
    && Number(detectedMapping.referenceStart) === Number(referenceStart)
    && Number(detectedMapping.orientation) === Number(orientation)
  );

  async function exportRequest() {
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const request = await buildAlphaGenomeRequest(project, options);
      if (generation.current !== current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "assured-alphagenome-request.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { if (generation.current === current) setError(e.message); }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function importReport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const current = generation.current;
    setBusy(true); setError(""); setReport(null);
    try {
      if (file.size > 5000000) throw new Error("Review JSON must be smaller than 5 MB.");
      const request = await buildAlphaGenomeRequest(project, options);
      const imported = validateAlphaGenomeReport(JSON.parse(await file.text()), request);
      if (generation.current !== current) return;
      setReport(imported);
      if (onUpdateProject) {
        onUpdateProject({
          alphaGenomeReview: {
            request,
            report: imported,
            importedAt: new Date().toISOString(),
            options: {
              chromosome: String(chromosome).replace(/^chr/i, ""),
              referenceStart: Number(referenceStart),
              orientation: Number(orientation),
              ontologyTerm: ontologyTerm.trim(),
              sequenceLength,
              donorIndex,
            },
          },
        });
      }
    } catch (e) { if (generation.current === current) setError(e.message); }
    finally { if (generation.current === current) setBusy(false); }
  }

  const supported = ["pm", "genomic-snv"].includes(project.designResult?.type);
  const donors = project.designResult?.os || [];
  const savedForReport = Boolean(project?.alphaGenomeReview?.report && project?.alphaGenomeReview?.request);
  const mappingReady = Number.isSafeInteger(Number(referenceStart)) && Number(referenceStart) >= 1 && [1, -1].includes(Number(orientation));
  const effectiveCompareB = compareIndexB === donorIndex
    ? Math.max(0, donors.findIndex((_, i) => i !== donorIndex))
    : compareIndexB;
  let donorCompare = null;
  let donorCompareError = "";
  if (supported && donors.length >= 2 && donorIndex !== effectiveCompareB) {
    try {
      donorCompare = compareDonorBlockerLayouts(project, {
        donorIndexA: donorIndex,
        donorIndexB: effectiveCompareB,
        referenceStart: mappingReady ? Number(referenceStart) : null,
        orientation: mappingReady ? Number(orientation) : 1,
      });
    } catch (e) {
      donorCompareError = e.message;
    }
  }
  return <details className="card alphagenome-review" style={{ marginTop: "1rem", padding: "1rem" }}>
    <summary><strong>AlphaGenome (research) · donor functional review</strong></summary>
    <p>
      <span style={{ display: "inline-block", padding: "0.1rem 0.45rem", borderRadius: 999, background: "#e0f2fe", color: "#075985", fontWeight: 700, fontSize: "0.75rem", marginRight: "0.4rem" }}>Research only</span>
      Compare reference, intended substitution, and intended substitution plus donor blockers for expression and splicing effects.
      Results are exploratory model evidence and do not change guide ranking, procurement status, or QC decisions.
      Hosted AlphaGenome access is for non-commercial research — see <code>tools/alphagenome/RESEARCH.md</code>.
    </p>
    {!supported ? <p className="muted">Generate a point-mutation or genomic SNP design to review a matched donor. Knockout and tag reviews are not supported in this research adapter yet.</p> : <>
      <p className="muted">Exporting stays local. Running the Python tool retrieves GRCh38 context from Ensembl and sends the three sequences to Google AlphaGenome. Your API key stays in your local environment — never in the browser or Vercel.</p>
      {detectedMapping?.grch38 ? (
        <p role="status" style={{ margin: "0.5rem 0", padding: "0.5rem 0.75rem", borderRadius: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", fontSize: "0.88rem" }}>
          <strong>Mapping detected from GenBank.</strong>{" "}
          {detectedMapping.label}: chr{detectedMapping.chromosome}:{detectedMapping.referenceStart}
          {detectedMapping.end ? `–${detectedMapping.end}` : ""} · strand {detectedMapping.orientation === -1 ? "−1" : "+1"} · {detectedMapping.assembly}.
          Fields below were auto-filled — confirm them before export.
          {!mappingAutoFilled && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginLeft: "0.5rem", padding: "0.15rem 0.5rem", fontSize: "0.78rem" }}
              onClick={() => {
                setChromosome(String(detectedMapping.chromosome));
                setReferenceStart(String(detectedMapping.referenceStart));
                setOrientation(String(detectedMapping.orientation));
                setConfirmed(false);
              }}
            >
              Restore detected mapping
            </button>
          )}
        </p>
      ) : detectedMapping && !detectedMapping.grch38 ? (
        <p role="status" style={{ margin: "0.5rem 0", padding: "0.5rem 0.75rem", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: "0.88rem" }}>
          Annotation found for {detectedMapping.assembly || "an unsupported assembly"} — AlphaGenome research review needs human GRCh38. No liftover is applied.
        </p>
      ) : (
        <p className="muted" style={{ margin: "0.5rem 0" }}>
          No verified genomic Location was found in this GenBank record (common for some RefSeqGene NG_ files). Enter chromosome, start and orientation manually, or re-fetch an Ensembl GRCh38 region.
        </p>
      )}
      <fieldset disabled={busy} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
        <legend>Human GRCh38 reference mapping</legend>
        <label>Chromosome <input aria-label="AlphaGenome chromosome" value={chromosome} onChange={e => { setChromosome(e.target.value); setConfirmed(false); }} placeholder="17" size={5} /></label>
        <label>Reference start (1-based, chromosome plus) <input type="number" min="1" value={referenceStart} onChange={e => { setReferenceStart(e.target.value); setConfirmed(false); }} /></label>
        <label>Uploaded reference orientation <select value={orientation} onChange={e => { setOrientation(e.target.value); setConfirmed(false); }}>
          <option value="">Select orientation</option><option value="1">Chromosome plus (+1)</option><option value="-1">Chromosome minus (−1)</option>
        </select></label>
        <label>Matched donor (review / A) <select aria-label="AlphaGenome matched donor A" value={donorIndex} onChange={e => {
          const next = Number(e.target.value);
          setDonorIndex(next);
          if (next === compareIndexB) {
            const fallback = donors.findIndex((_, i) => i !== next);
            if (fallback >= 0) setCompareIndexB(fallback);
          }
        }}>
          {donors.map((d, i) => <option key={i} value={i}>{d.n || `Donor ${i + 1}`}</option>)}
        </select></label>
        {donors.length >= 2 && (
          <label>Compare donor B <select aria-label="AlphaGenome compare donor B" value={effectiveCompareB} onChange={e => setCompareIndexB(Number(e.target.value))}>
            {donors.map((d, i) => <option key={i} value={i} disabled={i === donorIndex}>{d.n || `Donor ${i + 1}`}</option>)}
          </select></label>
        )}
        <label>Research tissue / cell type
          <select aria-label="AlphaGenome research tissue" value={ALPHAGENOME_RESEARCH_TISSUES.some(t => t.id === ontologyTerm) ? ontologyTerm : ""} onChange={e => setOntologyTerm(e.target.value)}>
            <option value="">Custom ontology ID…</option>
            {ALPHAGENOME_RESEARCH_TISSUES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>Tissue/cell ontology ID <input value={ontologyTerm} onChange={e => setOntologyTerm(e.target.value)} placeholder="UBERON:… / CL:… / EFO:…" /></label>
        <label>Context <select value={sequenceLength} onChange={e => setSequenceLength(Number(e.target.value))}>
          <option value={16384}>16,384 bp · local context</option><option value={131072}>131,072 bp · wider context</option>
        </select></label>
        <label className="alpha-review-confirmation" style={{ flexBasis: "100%" }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified that this reference maps to human GRCh38 at the chromosome start and orientation above.</label>
      </fieldset>
      <p className="muted">Presets are starting points for research lines. The ontology ID must still be present in AlphaGenome output metadata for your run; a missing match is reported as unavailable — no substitute tissue is chosen.</p>
      {donors.length >= 2 && (
        <div className="alpha-donor-compare" style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <h4 style={{ margin: "0 0 0.35rem" }}>Donor A vs B · blocker layouts</h4>
          <p className="muted" style={{ marginTop: 0 }}>
            Structural compare of silent/PAM blockers for the same intended edit. Functional AlphaGenome export/import still uses donor A (review donor) one at a time — switch A or export again for B.
            {!mappingReady && " Positions below are uploaded-reference indices until chromosome start and orientation are set."}
          </p>
          {donorCompareError && <p role="alert" className="error">{donorCompareError}</p>}
          {donorCompare && (
            <>
              <p style={{ fontSize: "0.9rem" }}>
                <strong>{donorCompare.donorA.name}</strong> · {donorCompare.summary.blockingOnlyA} unique blocker{donorCompare.summary.blockingOnlyA === 1 ? "" : "s"}
                {" · "}
                <strong>{donorCompare.donorB.name}</strong> · {donorCompare.summary.blockingOnlyB} unique blocker{donorCompare.summary.blockingOnlyB === 1 ? "" : "s"}
                {" · "}
                {donorCompare.summary.blockingShared} shared blocker{donorCompare.summary.blockingShared === 1 ? "" : "s"}
                {" · "}
                {donorCompare.summary.intendedShared} shared intended
              </p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{donorCompare.mapped ? "Chr position" : "Reference index"}</th>
                      <th>Ref → Alt</th>
                      <th>Membership</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donorCompare.rows.map((row) => (
                      <tr key={`${row.membership}-${row.position}-${row.ref}-${row.alt}-${row.role}`}>
                        <td>{row.position}</td>
                        <td>{row.ref}→{row.alt}</td>
                        <td>{row.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                After local AlphaGenome runs, compare each donor’s <em>intended → full donor</em> fold for blocker-associated track differences. Layout compare never gates release.
              </p>
            </>
          )}
        </div>
      )}
      <div className="alpha-review-actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
        <button className="btn btn-secondary" type="button" disabled={busy || !confirmed} onClick={exportRequest}>1. Export review request (donor A)</button>
        <label>2. Import completed review <input type="file" accept="application/json,.json" disabled={busy || !confirmed} onChange={importReport} /></label>
      </div>
      <p className="muted">
        Local instructions: <code>tools/alphagenome/README.md</code>.
        {savedForReport
          ? " Imported review is saved on this experiment and attached as a research fold when you download the design HTML report — it still does not gate release."
          : " After import, the review is saved on this experiment and included in the downloaded design HTML report as a research fold (not a release gate)."}
      </p>
      {busy && <p role="status">Checking the current donor review…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {report && <div>
        <h4>Functional review · model prediction</h4>
        <p>Model {report.modelVersion} · SDK {report.sdkVersion}. Raw track differences have assay-specific units; larger differences are not automatically harmful.</p>
        {report.comparisons.map(c => <details key={c.id}>
          <summary>{({ reference_to_intended: "Reference → intended edit", reference_to_full_donor: "Reference → full donor allele", intended_to_full_donor: "Intended edit → full donor allele (additional blocker-associated differences)" })[c.id]}</summary>
          <div style={{ overflowX: "auto" }}><table><thead><tr><th>Output / track</th><th>Mean absolute difference</th><th>Maximum absolute difference</th></tr></thead>
            <tbody>{c.tracks.map((t, i) => <tr key={i}><td>{t.output}: {t.name} ({t.strand})</td><td>{t.meanAbsDelta.toPrecision(4)}</td><td>{t.maxAbsDelta.toPrecision(4)}</td></tr>)}</tbody></table></div>
        </details>)}
        <p className="muted">Exploratory comparison across the selected context, not a calibrated gene-level variant score, editing-efficiency estimate, or experimental confirmation. Tissue coverage and biological effects require review.</p>
      </div>}
    </>}
  </details>;
}
