# Local AlphaGenome donor review

This optional first integration reviews **human GRCh38 substitution donors**.
It compares reference → intended edit, reference → full donor allele, and
intended edit → full donor allele. All blocking changes in one selected donor
are evaluated jointly. Donor alternatives are separate requests.

The existing design engine and QC release gates are unchanged. These are
exploratory RNA-seq / splice-site / splice-usage **raw track differences**, not
calibrated variant scores, pathogenicity calls, cutting efficiency or HDR yield.
Metrics are aggregated over the entire selected context, not a gene annotation
mask. Do not compare numbers across assays or interpret a zero as proven safety.
No automated release or ranking threshold is applied.

## 1. Set up locally

Use Python 3.10+ (3.12 recommended). Create a separate environment in the repository:

```bash
python3.12 -m venv .venv-alphagenome
.venv-alphagenome/bin/python -m pip install -r tools/alphagenome/requirements.txt
```

The adapter pins SDK 0.10.0 and selects `ModelVersion.ALL_FOLDS` explicitly.
The report records that selector and SDK version; the service does not expose
an immutable model-weights checksum here.

## 2. Export from Bench

Generate a point-mutation or genomic SNP design. Open **AlphaGenome · optional
donor functional review** below Workflow Agent. Choose one donor, enter the
chromosome, **lowest chromosome-plus coordinate of the complete uploaded
reference**, and orientation. For a minus-strand uploaded record, use −1; the
exporter reverses coordinates and complements alleles. No assembly or orientation
is guessed. Confirm the mapping only after checking it.

Enter the tissue/cell ontology ID from the model's output metadata. To inspect
available tracks in a local Python session with an API client:

```python
import os
from alphagenome.models import dna_client
client = dna_client.create(os.environ["ALPHAGENOME_API_KEY"])
metadata = client.output_metadata()
print(metadata.rna_seq)
print(metadata.splice_site_usage)
```

Use a supported, biologically appropriate `UBERON:…`, `CL:…`, or `EFO:…` ID.
Unsupported tracks fail rather than substituting an unrelated tissue. Tissue-
agnostic splice-site predictions may also be returned; inspect track metadata.
16,384 bp is the initial local-context option; 131,072 bp includes wider context
with greater resource use. Neither guarantees complete regulatory coverage.

Click **Export review request**. Move the file into an ignored `local-reviews/`
directory if desired. It contains sequence data and has not been sent anywhere.

## 3. Validate without network access

```bash
python3 tools/alphagenome/review.py local-reviews/assured-alphagenome-request.json --validate-only
```

This checks the request digest, mapping, alleles and supported settings. It does
**not** validate against the remote GRCh38 reference or make model predictions.

## 4. Run an actual review

Obtain your own [AlphaGenome API key](https://deepmind.google/science/alphagenome/).
The hosted API is currently offered for non-commercial research; review its
current terms for your intended use. Configure it through a hidden local prompt:

```bash
.venv-alphagenome/bin/python tools/alphagenome/configure_key.py
```

The prompt saves the key in ignored `local-reviews/alphagenome-api-key.local`,
with file permissions `0600` (your account only). It never echoes the key.
The runner loads it automatically. Alternatively, set `ALPHAGENOME_API_KEY` in
the local shell environment; that value takes precedence. Do not put the key in
Git, a request JSON, a `VITE_` variable or chat. Re-running setup replaces the
previous local key.

```bash
.venv-alphagenome/bin/python tools/alphagenome/review.py \
  local-reviews/assured-alphagenome-request.json \
  --run --output local-reviews/alphagenome-review.json
```

`--run` retrieves GRCh38 chromosome-plus context from Ensembl, checks **every
overlapping uploaded reference base**, then sends the reference/intended/full
donor sequences to Google AlphaGenome. A disagreement stops execution; the tool
does not silently replace sample variants, change assemblies, or pad chromosome
ends. Gene-oriented records without a verified genomic mapping cannot be used.
Reference and model requests require internet access. Existing output files are
not overwritten. Failures never produce a completed review.

## 5. Import and inspect

Use **Import completed review** in the same panel with the same mapping, donor,
tissue and context. The request SHA-256 prevents accidental reuse with different
inputs; it is not a signature authenticating Google's response. Only import
reports from a trusted local runner. Changed inputs clear the displayed result.

Inspect all three comparisons and the assay/track names. Results remain separate
review artifacts in this version; they are not persisted into Bench projects,
merged into design reports, or used as release gates. Preserve the JSON locally.

## Local checks

```bash
node --test test/alphagenome-review.test.js test/evidence-labels.test.js
.venv-alphagenome/bin/python -m unittest discover -s tools/alphagenome -p 'test_*.py' -v
```

The Python tests exercise the real SDK data types with **mock predictions and
mock reference retrieval**. Passing them does not establish live API access,
biological accuracy, or wet-lab calibration.

Sources: [SDK](https://github.com/google-deepmind/alphagenome),
[documentation](https://google-deepmind-alphagenome.readthedocs-hosted.com/).

## Broad PSC and derivative context panel (planning)

The **Analysis & evidence** view now provides a regulatory study panel for a
pluripotent reference and cardiac, neural, hepatic, pancreatic, vascular, renal,
muscle and immune contexts. Its coverage is generated from the human
`output_metadata` API. Each derivative entry is a lineage or tissue **proxy**;
its differentiation protocol and maturation state have not been matched to the
experimental cells. WTC11/H1/H9 are reference model contexts, not an automatic
assignment of the user's cell line.

**Use this study panel** adds a context plan to the current experiment. Use the
header **Save** button to retain it between sessions. The scientific
report includes the saved panel with an explicit **predictions not run** label.
Exporting a context plan stays local and contains no DNA, model predictions or API
credentials. This planning schema is not an executable v1 donor-review request.
It does not extend the substitution runner to knockout or insertion alleles, and
does not change guide selection or release decisions.

The default broad panel contains WTC11 and nine derivative/state contexts. H1, H9,
adult cardiac, additional neuronal, pancreatic, muscle and immune contexts can be
selected individually. Shared `SPLICE_SITES` predictions are not counted as
cell-specific splicing coverage. Assay counts describe model tracks, not
independent biological replicates.

Refresh the compact catalog explicitly with your local key:

```bash
.venv-alphagenome/bin/python tools/alphagenome/context_catalog.py \
  --refresh --output src/services/data/alphaGenomeContexts.json
```

For reproducible offline regeneration, provide a saved human metadata snapshot:

```bash
.venv-alphagenome/bin/python tools/alphagenome/context_catalog.py \
  --metadata-file local-reviews/alphagenome-human-output-metadata.json \
  --output src/services/data/alphaGenomeContexts.json
```

The next implementation stage requires exact edited-allele construction,
verified genomic mapping, indel-aware prediction/scoring, and persistence of
matched result evidence. A configured context panel alone is not a completed
regulatory review.


## Candidate pairs (`rank.py`)

Compares several donor alleles for one substitution, in one to four cell contexts, against the intended edit alone and
against random synonymous changes of the same size. See `docs/PM_CANDIDATES.md` for the rule and its limits.

```bash
python3 tools/alphagenome/rank.py request.json --validate-only
python3 tools/alphagenome/rank.py request.json --run --output report.json --null null-cache.json
```

The request comes from Bench (Alternative guides > Regulatory comparison). The key is read as in `review.py`; plus-strand genes only.

### One click from the page: `rank.py --serve`

```bash
python3 tools/alphagenome/rank.py --serve [--port 18765] [--origin https://your-bench.example] [--token CODE] [--null-dir DIR]
```

Starts a helper on 127.0.0.1 that the Bench page calls instead of the export/import steps. It prints a session code to paste
into the page, holds the key (same sources as `review.py`), caches nulls in `local-reviews/null-cache/`, and runs one
comparison at a time. Only the allowed page origins can use it (default `https://assured-bench.vercel.app`,
`http://localhost:5173`, `http://127.0.0.1:5173`). Routes: `GET /health`, `POST /rank`. Safeguards and browser notes are in
`docs/PM_CANDIDATES.md` section 2. Sequence windows still go to Google; non-commercial use only.
## Matched guide–donor comparison and bounded refinement

For **SpCas9 protein substitutions**, open **Guide–donor alternatives** after
creating a design. Generate up to six independent matched pairs, choose one
experimental cell context, then click **Review and refine with AlphaGenome**.
The first search uses distinct guides within 30 bp of the mutation. A second,
final search excludes individual earlier blocker positions and reconstructs
alternative synonymous blocking sets, giving at most twelve total pairs.
Fewer candidates are returned if valid distinct pairs cannot be constructed.
The intended amino-acid substitution is held fixed. Alternatives are never pooled.

Automatic execution is currently **local development only** (`npm run dev`).
The Vite adapter starts the pinned local Python environment and reads the same
private key as the single-donor runner. It accepts only same-origin loopback
requests, limits payload size, cancels disconnected jobs and permits one run at
a time. It does not bundle Python, expose a key or add an inference backend to
the static Vercel deployment. Hosted users can export a comparison request and
import the completed comparison under **Prediction evidence and reproducibility**:

```bash
.venv-alphagenome/bin/python tools/alphagenome/compare.py \
  local-reviews/assured-donor-comparison-request.json \
  --output local-reviews/assured-donor-comparison.json
```

The batch runner verifies a common reference, intended edit, ontology, output
set and prediction window before making predictions. All candidates use an
interval anchored on the intended substitution, not their different blocker
locations. Identical sequences reuse a prediction within each batch. Each
candidate retains all three reference/intended/full-donor comparisons.

Only **intended → full-donor** differences inform the comparative axes:

* Sum of absolute RNA signal differences in annotated exons divided by summed
  absolute intended-allele signal, on matching-strand tracks. This is a model
  signal ratio, not a fold change in measured gene expression.
* Maximum absolute cell-specific splice-usage difference within ±2 bp of internal
  annotated exon boundaries.
* Maximum absolute matching-strand splice-site probability difference over the
  whole context, including potential cryptic sites. These tracks are tissue-agnostic.

Top changes retain 1-based genomic position, before/after signal, signed delta
and exon/splice-boundary labels. The full transcript annotation must be covered
for the comparison axes to be usable. Missing outputs, an absent RNA baseline,
no usable splice boundaries or a failed prediction cannot produce a preference.
The report deliberately does not invent a harmful/safe threshold. Core failures
and weak re-cut protection exclude a candidate from preference. Among the
remaining candidates, Pareto dominance identifies those with no larger
blocker-associated difference on any axis and a smaller difference on at least
one. Ties and conflicting axes stay explicit. Lower disturbance does not prove
biological safety, and these exploratory criteria are not experimentally calibrated.

Use **Use pair-N** to apply one matched pair. Reagents, schematic and QC handoff
then read that complete single-pair result; guide-specific enrichment and earlier
clone results are invalidated. The project retains the comparison and selection;
use header **Save** to persist on this device. The scientific report documents
candidate metrics and model provenance. Changing source inputs invalidates the
panel; changing cell context or window hides the old recommendation.

This stage does not support candidate optimization for raw genomic SNVs,
knockouts, insertions, other enzymes or simultaneous multi-context ranking.
Genome-wide specificity, editing/HDR yield, protein function, disease phenotype,
other isoforms and effects beyond the prediction window remain separate checks.

The interface suggests a starting pair within the Pareto frontier using explicit
priorities: annotated splice-usage difference, exonic RNA disturbance, then
splice-site disturbance. Metric ties use fewer blockers, then closer cuts. This
is an exploratory engineering preference, not a claim of regulatory superiority
on every axis. The other frontier candidates and conflicts remain visible.

The TP53 R175H preset is supported without manually entering chromosome coordinates.
The exact bundled NG_017013.2 sequence is recognized by SHA-256 and its verified
full-length reverse-complement mapping to GRCh38 chr17:7,659,779–7,692,550. Modified
or different RefSeqGene sequences cannot reuse that mapping. The live runner
still checks every reference base overlapping the prediction interval.
Automatic reviews expand from 16,384 to 131,072 bp when needed to cover the full
annotated transcript; the UI shows the selected window. If even the wider window
cannot cover the annotation, no complete comparative preference is attempted.

## Simplified two-design workflow (current interface)

For SpCas9 point mutations, choose the mutation and **Cell type for AlphaGenome
review**, then click **Design and review**. A loaded preset already has a basic
design; choose its cell type and click **Design and review** on the result screen.
Candidate generation, two review rounds, window selection and application of two
eligible distinct guide–donor designs happen behind that one action. If model
coverage is incomplete or fewer than two eligible distinct guides remain, the
existing design stays in place and the incomplete comparison is reported.

The initial six include the **two original exact donors**, labelled **original**,
plus additional guide-linked alternatives. Up to six more blocker variants may
be evaluated in one bounded refinement round. The default result shows only the
two selected designs, their matched donor sequences through Selected reagents,
and remaining checks. Open **Compare alternatives** to choose a different two;
changing a checkbox does not change reagents until **Use these two designs** is
clicked. Two variants of the same guide cannot occupy both selection slots.
The two sequence-validated results, not the entire candidate pool, populate the
order handoff, scheme, report and QC export. Earlier clone and guide-specific
analysis records are invalidated on application.

**Advanced → Protect each donor against both guides** is optional and defaults
to independent matched-donor protection. Independent mode displays a cross-guide
protection matrix and a warning if a repaired allele remains susceptible to the
other active RNP. Transient RNP exposure does not establish absence of re-cutting.
Both modes record the cut spacing and potential intervening-deletion product.

With joint protection enabled, the automated search tests combinations from up
to six distinct eligible guides (at most fifteen combinations) for core joint
protection. Both final donors must preserve the intended amino-acid change and
strongly disrupt both guide targets. The first eligible combination under the
stated guide priorities is then reviewed using its **rebuilt final donor alleles**.
That final two-donor request and evidence are stored separately from the earlier
independent-candidate comparison. No final selection is applied if joint protection
or the final model review fails. This bounded engineering search is not an
exhaustive regulatory optimization over all possible combinations. The report
labels independent-candidate metrics separately from final joint-donor metrics.

This workflow recommends designs for experimental validation. It does not mark a
regulatory prediction as a safety certificate or predict an increase in editing
or HDR yield from co-transfection. Specificity and clone validation remain open.

## Genomic SNP comparison

The local **Genomic SNP** result now offers the same **Design and review** panel
as protein substitutions, for human GRCh38 / SpCas9 designs. Generate the genomic
SNP design, choose the experimental cell context, then run the review. Under
**Advanced**, **Protect each donor against both guides** rebuilds a shared
blocking set with the native genomic SNP engine and reviews the final alleles
again. The original two donors remain labelled baselines. Up to six initial
matched pairs and up to twelve total native PAM/seed donor versions are compared.
No blocking substitutions are introduced when the original policy is exact edit
only; joint protection must then come from the intended edit itself.

The comparison keeps forward-genome coordinates and REF/ALT alleles even when
the reference is written along a reverse-strand transcript. It separates
reference-to-intended, reference-to-final-donor, and intended-to-final-donor
predictions. Only the last comparison informs blocker-associated ranking. A
splice-altering disease SNP is therefore not optimized away.

Intronic and UTR SNPs can be reviewed against the annotated gene's RNA and
splicing tracks. The current automatic recommendation requires exon/splice
annotation, sufficient window coverage and usable RNA signal; intergenic or
annotation-free references do not receive a complete transcript-based preference.
It does not yet optimize ATAC/DNase, enhancer activity, TF binding or contacts.
Noncoding blockers are additional regulatory variants, not "silent" edits.
Specificity, parental genotype, RNA/protein outcomes and dual-cut deletions
remain experimental review requirements. Model review does not clear those gates.

## Hosted reviewer

The Vercel deployment includes a signed Python worker and a Node.js API. Set
`ALPHAGENOME_API_KEY`, `ASSURED_REVIEW_SECRET` (at least 32 random characters), and
`ASSURED_REVIEW_ACCESS_HASH` (SHA-256 of a private, random analysis access code) as
server-side sensitive variables. Connect a **private** Vercel Blob store; the SDK
uses the connected `BLOB_STORE_ID` with Vercel OIDC, or a server-side
`BLOB_READ_WRITE_TOKEN`. No secret uses a `VITE_` prefix.

Unlock online analysis once with the analysis access code. It is not the provider
API key. The server issues a Secure, HttpOnly, SameSite cookie valid for seven
days. This first version is one private research workspace; holders of the access
code share its reviewer and results. It is not a multi-tenant patient-data system.

POST `/api/alphagenome/compare` validates and stores a bounded request, then sends
a durable queue message. The queue has one active consumer, at most two delivery
attempts and a one-hour message lifetime. The consumer calls the Python worker
with a short-lived body-bound HMAC; public unsigned calls cannot run predictions.
Progress, requests and reports are stored privately. Only authenticated requests
can retrieve them through `/api/alphagenome/jobs`. Provider diagnostics are never
returned or persisted. Requests go to Ensembl for reference validation and Google
for predictions; these are the same services used by the local runner.

Stopping the browser wait leaves the cloud job running. Repeating an identical
review retrieves the cached job instead of spending another set of predictions.
The report uses the existing identity, context and evidence validators before
applying either donor. Completed experiments are still saved in the browser;
cloud storage holds the comparison jobs and evidence, not whole experiment data.
Private jobs are retained until the project owner removes them from storage.

The two-design selector prefers guide cuts at least 10 bp apart, consistent with
the native pair planner, before trying near-coincident cuts. This is an engineering
preference; both choices still require screening for dual-cut deletion products.
