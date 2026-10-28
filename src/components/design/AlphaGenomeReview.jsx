import React, { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { alphaGenomeMapping, buildAlphaGenomeRequest, intendedEditIndex, validateAlphaGenomeReport } from "../../services/alphaGenomeReview.js";
import { HUMAN_CHROMOSOMES, normalizeChromosome } from "../../services/candidateRanking.js";
import { mappingNote, useMappingLookup } from "./useMappingLookup.js";

export function AlphaGenomeReview({ project, lookupFetch, initialLookup = null, onReviewDesigns }) {
  const declared = alphaGenomeMapping(project);
  const [chromosome, setChromosome] = useState(declared?.chromosome || "");
  const [referenceStart, setReferenceStart] = useState(declared?.referenceStart || "");
  const [orientation, setOrientation] = useState(declared?.orientation || "");
  const [ontologyTerm, setOntologyTerm] = useState("");
  const [sequenceLength, setSequenceLength] = useState(16384);
  const [donorIndex, setDonorIndex] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const options = { assembly: "GRCh38", chromosome, referenceStart: Number(referenceStart), orientation: Number(orientation), ontologyTerm: ontologyTerm.trim(), sequenceLength, donorIndex, mappingConfirmed: confirmed };

  useEffect(() => {
    generation.current += 1;
    setReport(null); setError(""); setBusy(false);
    return () => { generation.current += 1; };
  }, [project.designResult, project.genbankRaw, chromosome, referenceStart, orientation, ontologyTerm, sequenceLength, donorIndex, confirmed]);

  useEffect(() => {
    const mapping = alphaGenomeMapping(project);
    setChromosome(mapping?.chromosome || ""); setReferenceStart(mapping?.referenceStart || "");
    setOrientation(mapping?.orientation || ""); setConfirmed(false); setDonorIndex(0);
  }, [project.id, project.genbankRaw]);

  // The position of the reference in GRCh38, from the design (gene and edit site) and Ensembl, when the record does not state it.
  const supported = ["pm", "genomic-snv"].includes(project.designResult?.type);
  const geneSymbol = project.designResult?.gene || project.gene;
  const editIndex = supported ? intendedEditIndex(project) : null;
  const current = useRef({});
  current.current = { chromosome, referenceStart };
  const { lookup, start: runLookup } = useMappingLookup({
    enabled: supported && !declared && Boolean(geneSymbol) && editIndex != null, gene: geneSymbol, sequence: project.designResult?.gb?.genomicSequence, editIndex,
    orientations: [1, -1], resetKey: project.genbankRaw, fetchImpl: lookupFetch, initial: initialLookup,
    apply: (out, overwrite) => {
      if (!overwrite && (current.current.chromosome || current.current.referenceStart)) return; // never replace what the user typed
      setChromosome(out.chromosome); setReferenceStart(out.referenceStart); setOrientation(String(out.orientation)); setConfirmed(false);
    },
  });
  const start = Number(referenceStart);
  const missing = [
    ...(HUMAN_CHROMOSOMES.includes(normalizeChromosome(chromosome)) ? [] : ["select the chromosome"]),
    ...(Number.isSafeInteger(start) && start >= 1 ? [] : ["enter the GRCh38 position (1-based) of the first base of the uploaded sequence"]),
    ...(["1", "-1"].includes(String(orientation)) ? [] : ["choose the orientation"]),
    ...(confirmed ? [] : ["tick the confirmation"]),
  ];
  const fromLookup = lookup.status === "ok" && String(lookup.result.referenceStart) === String(referenceStart) && lookup.result.chromosome === normalizeChromosome(chromosome) && String(lookup.result.orientation) === String(orientation);

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
      if (generation.current === current) setReport(imported);
    } catch (e) { if (generation.current === current) setError(e.message); }
    finally { if (generation.current === current) setBusy(false); }
  }

  return <section aria-label="AlphaGenome regulatory review" className="card alphagenome-review" style={{ marginTop: "1rem", padding: "1rem" }}>
    <h3>AlphaGenome regulatory review</h3>
    <p>Compares your intended edit with the final donor design to assess additional predicted expression and splicing effects in your selected cell context. These predictions help compare donor designs; they do not establish safety, editing efficiency, or disease phenotype.</p>
    <ul>
      <li><strong>Reference → intended edit:</strong> predicted effects of the mutation you want.</li>
      <li><strong>Intended edit → edit plus blockers:</strong> additional predicted effects of donor protection changes.</li>
      <li><strong>Reference → final edited allele:</strong> total predicted effect of the edit and blockers together.</li>
    </ul>
    {onReviewDesigns && <><p>Run Design and review from Selected design to compare guide–donor pairs. Online analysis runs on the server, where your AlphaGenome API key is kept.</p><button type="button" className="btn btn-secondary" onClick={onReviewDesigns}>Open design review</button></>}
    {!supported ? <p className="muted">Generate a point-mutation or genomic SNP design to review a matched donor. Knockout and tag reviews are not supported in this first version.</p> : <>
      <details style={{ marginTop: "1rem" }}>
      <summary>Advanced · local export and import</summary>
      <p className="muted">For a separate review of one donor, export a request and run the local Python tool. Exporting does not send sequences. The Python tool retrieves GRCh38 context from Ensembl and sends the three sequences to Google AlphaGenome, using the API key in your local environment.</p>
      <fieldset disabled={busy} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
        <legend>Human GRCh38 reference mapping</legend>
        <label>Chromosome <select aria-label="AlphaGenome chromosome" value={HUMAN_CHROMOSOMES.includes(normalizeChromosome(chromosome)) ? normalizeChromosome(chromosome) : ""} onChange={e => { setChromosome(e.target.value); setConfirmed(false); }}><option value="">Select…</option>{HUMAN_CHROMOSOMES.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Reference start (1-based, chromosome plus) <input type="number" min="1" value={referenceStart} onChange={e => { setReferenceStart(e.target.value); setConfirmed(false); }} /></label>
        <label>Uploaded reference orientation <select value={orientation} onChange={e => { setOrientation(e.target.value); setConfirmed(false); }}>
          <option value="">Select orientation</option><option value="1">Chromosome plus (+1)</option><option value="-1">Chromosome minus (−1)</option>
        </select></label>
        <label>Matched donor <select value={donorIndex} onChange={e => setDonorIndex(Number(e.target.value))}>
          {(project.designResult.os || []).map((d, i) => <option key={i} value={i}>{d.n || `Donor ${i + 1}`}</option>)}
        </select></label>
        <label>Tissue/cell ontology ID <input value={ontologyTerm} onChange={e => setOntologyTerm(e.target.value)} placeholder="UBERON:… / CL:… / EFO:…" /></label>
        <label>Context <select value={sequenceLength} onChange={e => setSequenceLength(Number(e.target.value))}>
          <option value={16384}>16,384 bp · local context</option><option value={131072}>131,072 bp · wider context</option>
        </select></label>
        <button type="button" className="btn btn-secondary" disabled={lookup.status === "running" || !geneSymbol || editIndex == null} onClick={() => runLookup({ overwrite: true })} title="Looks up the gene's position in Ensembl (GRCh38), finds your sequence inside it and compares them. Only the gene symbol and coordinates are sent."><Search size={14} /> Fill from design</button>
        <label className="alpha-review-confirmation" style={{ flexBasis: "100%" }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified that this reference maps to human GRCh38 at the chromosome start and orientation above.</label>
      </fieldset>
      <p role="note" className="muted">{mappingNote({ missing, detected: Boolean(declared), lookup, geneSymbol, ready: !missing.length, fromLookup, before: "Before exporting", readySuffix: "Mapping ready: the review tool checks it against GRCh38 before predicting and refuses a mismatch." })}</p>
      <p className="muted">Choose an ontology identifier supported by AlphaGenome output metadata for your experimental tissue/cell type. A missing match is reported as unavailable; no substitute tissue is chosen.</p>
      <div className="alpha-review-actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
        <button className="btn btn-secondary" type="button" disabled={busy || !confirmed} onClick={exportRequest}>1. Export review request</button>
        <label>2. Import completed review <input type="file" accept="application/json,.json" disabled={busy || !confirmed} onChange={importReport} /></label>
      </div>
      <p className="muted">Local instructions: <code>tools/alphagenome/README.md</code>. Keep the resulting JSON as a separate review artifact; it is not saved into the design or used to release a design.</p>
      </details>
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
  </section>;
}
