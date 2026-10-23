import { headline } from "./batch.js";
import { cloneProteinFigure } from "./proteinFigure.js";
import { cloneAlignedFigure } from "./alignedFigure.js";
import { saveSvg, savePng, savePdf } from "./saveFigure.js";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`);

export default function Detail({ workflow, result, headerExtra = null }) {
  if (!result) return null;
  if (!result.ok) return <div className="card"><h2>{result.name}</h2>{headerExtra}<p className="error">{result.error}</p></div>;
  if (result.kind === "junction") {
    return (
      <div className="card">
        <h2>{result.name}</h2>
        {headerExtra}
        <p className={result.verdict.status}>{result.verdict.summary}</p>
        <ul>{result.verdict.details.map((d) => <li key={d}>{d}</li>)}</ul>
        <p className="muted">Orientation {result.orientation}; {result.alignedBases} aligned bases at {(result.identity * 100).toFixed(1)}% identity. 5′ junction spanned: {String(result.spans.fivePrimeJunction)}; 3′ junction spanned: {String(result.spans.threePrimeJunction)}; genomic flank bases: {result.spans.genomicFlankBases}.</p>
        {result.events.length > 0 && (
          <table>
            <thead><tr><th>Difference</th><th>Region</th><th>Allele position</th><th>Detail</th><th>Quality</th></tr></thead>
            <tbody>{result.events.map((e, i) => <tr key={i}><td>{e.type}{e.expectedChange ? " (designed change)" : ""}</td><td>{e.region}</td><td>{e.alleleIndex}</td><td>{e.detail}</td><td>{e.quality}</td></tr>)}</tbody>
          </table>
        )}
        {result.markers.some((m) => m.covered) && (
          <table>
            <thead><tr><th>Position</th><th>Change</th><th>Read shows</th></tr></thead>
            <tbody>{result.markers.map((m) => <tr key={m.position}><td>{m.position}</td><td>{m.change} {m.label}</td><td>{m.covered ? (m.present ? `designed base (${m.base})` : `not the designed base (${m.base})`) : "not covered by this read"}</td></tr>)}</tbody>
          </table>
        )}
        {result.bands && <p><b>Out-out PCR:</b> {result.bands.call}. {result.bands.summary}</p>}
      </div>
    );
  }
  const s = result.summary;
  return (
    <div className="card">
      <h2>{result.name}</h2>
      {headerExtra}
      <p>{headline(workflow, result)}</p>
      {result.genotype && <ul>{result.genotype.flags.map((f) => <li key={f} className="muted">{f}</li>)}</ul>}
      <table>
        <thead><tr><th>Wild type</th><th>Edited</th><th>Indels</th><th>Between cuts</th><th>{workflow === "snp" || workflow === "tag_small" ? "HDR score (intended edit)" : "Intended edit"}</th><th>Blocking-only</th><th>{result.functional ? "Frameshift score (proxy)" : "KO score (frameshift proxy)"}</th>{result.functional && <th>Functional KO</th>}<th>Unexplained</th></tr></thead>
        <tbody><tr><td>{s.wtPct}%</td><td>{s.editedPct}%</td><td>{s.indelPct}%</td><td>{s.betweenCutsPct}%</td><td>{s.intendedEditPct}%</td><td>{s.partialConversionPct}%</td><td>{s.koScorePct}%</td>{result.functional && <td>{s.functionalKoPct}%</td>}<td>{s.unexplainedPct ?? 0}%</td></tr></tbody>
      </table>
      {!result.functional && (workflow === "knockout" || workflow === "deletion") && (
        <p className="muted">KO score here is a frameshift proxy: the share of alleles whose net length change is not divisible by three, or that are at least 21 bp. It does not look at the coding sequence. Add the gene record (GenBank) to get a functional knockout assessment.</p>
      )}
      {result.view && (() => { const svg = cloneAlignedFigure(result.view, { name: result.name, decision: result.decision ? result.decision.decision : "", headline: headline(workflow, result) }); return (
        <div>
          <h3>Chromatogram aligned with the wild-type control</h3>
          <div className="chart" dangerouslySetInnerHTML={{ __html: svg }} />
          <p><button type="button" className="link" onClick={() => saveSvg(`${result.name}_aligned.svg`, svg)}>Aligned chromatogram (SVG)</button><button type="button" className="link" onClick={() => savePng(`${result.name}_aligned_300dpi.png`, svg)}>Aligned chromatogram (PNG, 300 dpi)</button><button type="button" className="link" onClick={() => savePdf(`${result.name}_aligned.pdf`, svg)}>Aligned chromatogram (PDF)</button></p>
        </div>
      ); })()}
      {result.functional && (
        <div>
          <h3>Functional knockout assessment</h3>
          <p><b>{result.functional.call.text}</b> Functional knockout score {s.functionalKoPct}%{result.intervals && result.intervals.functionalKoPct ? ` (95% interval ${result.intervals.functionalKoPct[0]}-${result.intervals.functionalKoPct[1]}%)` : ""}, uncertain {s.functionalUncertainPct}%. Coding sequence of {result.functional.context.transcript}: {result.functional.context.proteinLength} residues in {result.functional.context.codingExons} coding exons.</p>
          <table>
            <thead><tr><th>Allele</th><th>Share</th><th>Predicted effect on the protein</th><th>Loss of function</th></tr></thead>
            <tbody>{result.functional.rows.filter((x) => x.fraction >= 0.01).map((x) => (
              <tr key={x.label + x.fraction}><td>{x.label}</td><td>{pct(x.fraction)}</td><td>{x.summary}</td><td>{x.lof === true ? "yes" : x.lof === false ? "no" : "uncertain"}</td></tr>
            ))}</tbody>
          </table>
          {(() => { const svg = cloneProteinFigure(result); return svg ? (
            <div>
              <div className="chart" dangerouslySetInnerHTML={{ __html: svg }} />
              <p><button type="button" className="link" onClick={() => saveSvg(`${result.name}_protein_products.svg`, svg)}>Protein products (SVG)</button><button type="button" className="link" onClick={() => savePng(`${result.name}_protein_products_300dpi.png`, svg)}>Protein products (PNG, 300 dpi)</button><button type="button" className="link" onClick={() => savePdf(`${result.name}_protein_products.pdf`, svg)}>Protein products (PDF)</button></p>
            </div>
          ) : null; })()}
          <p className="muted">Predicted from sequence only. Nonsense-mediated decay follows the exon-junction rules (a stop in the last coding exon, within 55 nt of the last junction, within 150 nt of the start codon, or in a coding exon over 407 nt escapes); these rules fail for roughly a third of premature stops. A knockout is confirmed by loss of protein.</p>
          {result.functional.caveats.length > 0 && <ul>{result.functional.caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
          {result.functional.confirm.length > 0 && <><p><b>To confirm</b></p><ul>{result.functional.confirm.map((c) => <li key={c}>{c}</li>)}</ul></>}
        </div>
      )}
      <div className="chart" dangerouslySetInnerHTML={{ __html: result.charts.contributions }} />
      <div className="chart" dangerouslySetInnerHTML={{ __html: result.charts.discordance }} />
      {(workflow === "snp" || workflow === "tag_small") && result.markers.some((m) => m.covered) && (
        <table>
          <thead><tr><th>Position</th><th>Change</th><th>Role</th><th>Donor base in edited</th><th>in control</th><th>Net</th></tr></thead>
          <tbody>{result.markers.map((m) => (
            <tr key={m.position}><td>{m.position}</td><td>{m.change} {m.label}</td><td>{m.role}</td>{m.covered ? <><td>{pct(m.altEdited)}</td><td>{pct(m.altControl)}</td><td>{pct(m.altNet)}</td></> : <td colSpan={3} className="muted">{m.reason}</td>}</tr>
          ))}</tbody>
        </table>
      )}
      <p className="muted">Fit R² {result.quality.r2 ?? "n/a"}; background {pct(result.quality.noiseFraction)}; {result.quality.positionsUsed} positions in the window.</p>
      {result.warnings.length > 0 && <ul>{result.warnings.map((w) => <li key={w} className="warn">{w}</li>)}</ul>}
    </div>
  );
}
