# Co-Scientist evidence and local AlphaGenome review

This change adds an optional human-GRCh38 substitution-donor review and explicit
Co-Scientist evidence-source labels. It was integrated with the newer `main`
audit, screening, variant-screening, guide-picker and take-home-summary changes.

## Current evidence behavior

- Reference provenance distinguishes bundled, user-provided, live and unknown
  inputs. Sequence lengths count bases rather than GenBank file characters.
- UniProt protein and domain evidence is reported as live or missing. No bundled
  domain/constraint fallback is introduced. Gene constraint and essentiality use
  the existing Open Targets query; population variants use the live dbSNP screen.
- Evidence-source labels are visible in Co-Scientist details and exported HTML.
- Execution remains rule-based. SpCas9-only Lindel ranking is not run for another
  enzyme. Screening retains `main`'s selected-pair model, explicit assumptions,
  missing-data behavior, and refusal to invent knock-in HDR yields.
- QC acceptance remains separate from biological confirmation. No AlphaGenome
  output changes a design ranking, procurement status or QC release gate.

## Optional AlphaGenome review

After a substitution design, open **AlphaGenome · optional donor functional
review** below the folded Co-Scientist checks. Export one selected donor request,
run the pinned Python SDK adapter locally, and import its request-bound report.
The browser never receives an API key. Setup, external sequence processing and
limitations are described in [the adapter instructions](../tools/alphagenome/README.md).

Requests require an explicitly confirmed human-GRCh38 chromosome mapping,
orientation, tissue ontology, donor and context size. The adapter validates every
uploaded base overlapping the fetched context before prediction. Donor edits are
compared jointly, not by adding individual SNP scores. Changed inputs clear the
panel; stale or incomplete reports are rejected. Results remain separate local
artifacts rather than being persisted into projects or used as release gates.

A real TP53 R175H fixture exposed an existing QC export bug: the default SpCas9
result may omit the optional enzyme object, causing the intended mutation to be
labeled as blocking. Intended positions now use the explicit mutation list for
all protein-substitution designs, with a regression test.

## Verification

- JavaScript request tests cover a real TP53 design, alternate donors, reverse-
  strand coordinates/alleles, explicit mapping, offline Python validation,
  request digests, stale imports, missing outputs and malformed metrics.
- Evidence-label tests cover live/missing annotations, true base counts,
  enzyme-specific Lindel planning, and escaped HTML source text.
- Five Python tests exercise the pinned SDK data types with mock predictions,
  context validation, joint alleles, missing/non-finite outputs, and private key
  configuration. These tests make no model calls.
- Chrome checks cover export, offline validation, mock and real report imports,
  stale-donor rejection, and unsupported knockout designs. Desktop and 390 px
  mobile layouts were checked. The real APOE report was also imported against
  the combined `main` version without browser errors.
- The production build succeeds with the existing large-bundle warning. The
  dependency audit uses the repository's existing policy and documented xlsx
  advisory exceptions.

The API key, Python environment, raw model outputs and analysis artifacts remain
ignored by Git. Pre-existing local Ensembl/storage edits are kept separate from
this change.

## Live API checks and exploratory APOE comparison

Authenticated access and real output metadata were checked with SDK 0.10.0 and
model selector ALL_FOLDS. The bundled APOE R176C reference matched GRCh38 before
inference. Reference, intended-only and full-donor predictions returned RNA-seq,
splice-site and splice-usage data for liver ontology UBERON:0002107.

Both matched donors were then compared on one identical 16,384 bp context with
splice-junction predictions added. Full-CDS translation checks confirmed exactly
R176C with no extra amino-acid substitutions. Canonical junction signals changed
by at most approximately 1.00% (donor 1) and 0.35% (donor 2), relative to intended-
only. Donor 1 increased a low-usage cryptic-acceptor signal in exon 4. Donor 2
showed smaller additional perturbations in the selected metrics, supporting
further review with its own matched guide; cross-guide protection remained weak.

These are exploratory, context-specific model results, not experimental
confirmation, a calibrated safety threshold or proof of editing efficiency.
The public-reference analysis, raw arrays and reproducible scripts are retained
locally and are not shipped in the repository.

## Further work

Adaptive planning, broader live tissue/locus checks, annotation-aware result
integration and experimental benchmarking remain separate stages. No LLM or
hosted backend is introduced by this change.
