import React, { useRef, useState } from "react";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { summariseCloneSplice, summariseCloneAlphaGenome, SPLICE_CHECK_THRESHOLDS } from "../../services/cloneReview.js";
import { REGULATORY_CONTEXT_CATALOG } from "../../services/regulatoryContexts.js";
import { ALLELE_CONTEXT_LENGTHS } from "../../services/alphaGenomeAlleles.js";
import { downloadFile } from "../../services/downloadFile.js";

const contexts = REGULATORY_CONTEXT_CATALOG.contexts.filter(c => c.outputTracks.RNA_SEQ && c.outputTracks.SPLICE_SITE_USAGE);
const MAX_FILE = 6000000;
const VERDICT_BADGE = { pass: "badge badge-ready", review: "badge badge-review", fail: "badge badge-blocked" };
const VERDICT_WORD = { pass: "supports", review: "review", fail: "advises against" };

function download(data, name) {
  downloadFile(JSON.stringify(data, null, 2), name, "application/json");
}
const slug = text => String(text || "locus").replace(/[^a-z0-9_-]/gi, "_");

/**
 * Splice and expression review of the alleles the clones were found to carry. Bench never runs the predictors: it exports a request, the predictor runs on the
 * user's machine (tools/spliceai, tools/alphagenome), and the result is imported only if it belongs to exactly this request.
 */
export function CloneReviewPanel({ project, review, settings, onSettings, onUpdateProject }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const spliceInput = useRef(null);
  const agInput = useRef(null);
  const { splice, alphagenome, saved } = review;
  const gene = slug(project.gene);

  async function importResult(file, kind) {
    setError(""); setMessage("");
    try {
      if (!file) return;
      if (file.size > MAX_FILE) throw new Error("The result file must be smaller than 6 MB.");
      const data = JSON.parse(await file.text());
      if (kind === "splice") {
        if (!splice.request) throw new Error(splice.error || "There is no SpliceAI request for the current clones.");
        const summary = summariseCloneSplice(splice.request, data);
        onUpdateProject({ cloneReview: { ...(project.cloneReview || {}), splice: { requestId: splice.request.requestId, importedAt: new Date().toISOString(), summary, result: data } } });
        setMessage(`SpliceAI result imported (${summary.tool} ${summary.version}, ${Object.keys(summary.clones).length} clones).`);
      } else {
        if (!alphagenome.request) throw new Error(alphagenome.error || "There is no AlphaGenome request for the current clones.");
        const summary = summariseCloneAlphaGenome(alphagenome.request, data);
        onUpdateProject({ cloneReview: { ...(project.cloneReview || {}), alphagenome: { requestId: alphagenome.request.requestId, importedAt: new Date().toISOString(), summary } } });
        setMessage(`AlphaGenome report imported (${summary.modelVersion}, ${Object.keys(summary.clones).length} clones).`);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      if (spliceInput.current) spliceInput.current.value = "";
      if (agInput.current) agInput.current.value = "";
    }
  }

  const spliceNow = review.review?.splice; const agNow = review.review?.alphagenome;
  const names = new Set([...Object.keys(spliceNow?.clones || {}), ...Object.keys(agNow?.clones || {})]);
  const rows = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const alleles = splice.request?.alleles || [];

  return (
    <section className="card" aria-labelledby="clone-review-heading">
      <div className="card-title" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <h3 id="clone-review-heading" style={{ margin: 0 }}>Splice &amp; expression review of the clone alleles</h3>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0.5rem 0" }}>
        The design review predicted the planned edit. This asks the same predictors about what the clones were found to carry: the intended edit as read, any base the design did not plan, any indel allele.
        Both run on your computer; the results are model predictions, not measurements. A base seen in a trace cannot be placed on one allele, so an unplanned base is assumed to sit on the allele that carries the intended edit.
      </p>
      {alleles.length > 0 && (
        <p style={{ fontSize: "0.85rem" }}>
          {alleles.length} allele{alleles.length === 1 ? "" : "s"} over {new Set(alleles.flatMap(a => a.clones.map(c => c.name))).size} clone{new Set(alleles.flatMap(a => a.clones.map(c => c.name))).size === 1 ? "" : "s"} to review
          ({alleles.filter(a => a.unwanted).length} with an unplanned base or an indel).
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
        <div style={{ border: "1px solid var(--border-color)", borderRadius: 8, padding: "0.85rem 1rem" }}>
          <strong>SpliceAI</strong>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.35rem 0" }}>
            Effect of the unwanted edits on the intended allele; supports &le; {SPLICE_CHECK_THRESHOLDS.pass}, review &le; {SPLICE_CHECK_THRESHOLDS.review}, above that advises against (the design review's cut-offs).
          </p>
          {splice.error && <p role="alert" style={{ color: "var(--warning)", fontSize: "0.85rem" }}><AlertTriangle size={14} /> {splice.error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={!splice.request} onClick={() => download(splice.request, `${gene}_clone_splice_request.json`)}><Download size={14} /> <span>Export SpliceAI request</span></button>
            <button type="button" className="btn btn-secondary" disabled={!splice.request} onClick={() => spliceInput.current?.click()}><Upload size={14} /> <span>Import SpliceAI result</span></button>
            <input ref={spliceInput} type="file" accept="application/json,.json" aria-label="SpliceAI clone result file" style={{ display: "none" }} onChange={e => importResult(e.target.files?.[0], "splice")} />
          </div>
          <pre style={{ fontSize: "0.72rem", whiteSpace: "pre-wrap", margin: "0.5rem 0 0", color: "var(--text-muted)" }}>python tools/spliceai/clone_splice_check.py {gene}_clone_splice_request.json reference.gb -o clone_splice_result.json</pre>
          {saved.splice && !splice.fresh && <p role="status" style={{ color: "var(--warning)", fontSize: "0.82rem" }}>The imported SpliceAI result belongs to an earlier set of clones or alleles and is not used. Export the request again and run it.</p>}
        </div>
        <div style={{ border: "1px solid var(--border-color)", borderRadius: 8, padding: "0.85rem 1rem" }}>
          <strong>AlphaGenome</strong>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.35rem 0" }}>
            Raw RNA and splice-site track differences against the intended allele; no calibrated threshold, so it ranks clones and gives no verdict. Needs a mapped human GRCh38 reference and your own API key.
          </p>
          <label style={{ display: "block", fontSize: "0.85rem" }}>Experimental cell type{" "}
            <select aria-label="Cell type for the clone AlphaGenome review" value={settings.ontologyTerm} onChange={e => { onSettings({ ...settings, ontologyTerm: e.target.value }); onUpdateProject({ alleleReviewContext: e.target.value }); }}>
              <option value="">Choose cell type</option>
              {contexts.map(c => <option key={c.id} value={c.ontology}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ display: "block", fontSize: "0.85rem", margin: "0.35rem 0" }}>Prediction window{" "}
            <select aria-label="Prediction window for the clone AlphaGenome review" value={settings.sequenceLength} onChange={e => onSettings({ ...settings, sequenceLength: Number(e.target.value) })}>
              {ALLELE_CONTEXT_LENGTHS.map(n => <option key={n} value={n}>{n.toLocaleString()} bp</option>)}
            </select>
          </label>
          {alphagenome.error && settings.ontologyTerm && <p role="alert" style={{ color: "var(--warning)", fontSize: "0.85rem" }}><AlertTriangle size={14} /> {alphagenome.error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={!alphagenome.request} onClick={() => download(alphagenome.request, `${gene}_clone_alphagenome_request.json`)}><Download size={14} /> <span>Export AlphaGenome request</span></button>
            <button type="button" className="btn btn-secondary" disabled={!alphagenome.request} onClick={() => agInput.current?.click()}><Upload size={14} /> <span>Import AlphaGenome report</span></button>
            <input ref={agInput} type="file" accept="application/json,.json" aria-label="AlphaGenome clone report file" style={{ display: "none" }} onChange={e => importResult(e.target.files?.[0], "alphagenome")} />
          </div>
          <pre style={{ fontSize: "0.72rem", whiteSpace: "pre-wrap", margin: "0.5rem 0 0", color: "var(--text-muted)" }}>python tools/alphagenome/clones.py {gene}_clone_alphagenome_request.json --validate-only{"\n"}python tools/alphagenome/clones.py {gene}_clone_alphagenome_request.json --run --output clone_alphagenome_report.json</pre>
          {saved.alphagenome && !alphagenome.fresh && <p role="status" style={{ color: "var(--warning)", fontSize: "0.82rem" }}>The imported AlphaGenome report belongs to an earlier set of clones, alleles, cell type or window and is not used. Export the request again and run it.</p>}
        </div>
      </div>

      {message && <p role="status" style={{ color: "var(--success)", fontSize: "0.85rem", marginTop: "0.6rem" }}>{message}</p>}
      {error && <p role="alert" style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.6rem" }}>{error}</p>}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
          <table aria-label="Predicted splice and expression effect per clone">
            <thead><tr><th>Clone</th><th>Allele reviewed</th><th>SpliceAI effect</th><th>SpliceAI verdict</th><th>Basis</th><th>AlphaGenome splice-site change</th></tr></thead>
            <tbody>
              {rows.map(name => {
                const s = spliceNow?.clones?.[name]; const a = agNow?.clones?.[name];
                return (
                  <tr key={name}>
                    <td><strong>{name}</strong></td>
                    <td>{(s || a).label}</td>
                    <td className="mono">{s ? s.effect.toFixed(3) : "—"}</td>
                    <td>{s ? <span className={VERDICT_BADGE[s.verdict]}>{VERDICT_WORD[s.verdict]}</span> : "—"}</td>
                    <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{s ? s.basis : "—"}</td>
                    <td className="mono">{a ? a.spliceScore.toPrecision(3) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
            {spliceNow && `${spliceNow.tool} ${spliceNow.version}. `}{agNow && `AlphaGenome ${agNow.modelVersion}, ${(agNow.ontologyTerms || []).join(", ")}. `}
            A clone that was not reviewed carried no allele to predict (wild type, rejected without a flagged change, or unreadable).
          </p>
        </div>
      )}
    </section>
  );
}
