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
python3 tools/alphagenome/rank.py --serve [--port 8765] [--origin https://your-bench.example] [--token CODE] [--null-dir DIR]
```

Starts a helper on 127.0.0.1 that the Bench page calls instead of the export/import steps. It prints a session code to paste
into the page, holds the key (same sources as `review.py`), caches nulls in `local-reviews/null-cache/`, and runs one
comparison at a time. Only the allowed page origins can use it (default `https://assured-bench.vercel.app`,
`http://localhost:5173`, `http://127.0.0.1:5173`). Routes: `GET /health`, `POST /rank`. Safeguards and browser notes are in
`docs/PM_CANDIDATES.md` section 2. Sequence windows still go to Google; non-commercial use only.
