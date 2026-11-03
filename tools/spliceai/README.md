# Local SpliceAI review of clone alleles

`clone_splice_check.py` scores the alleles a clone was found to carry (the intended edit as read, any base the design did not plan, any indel allele) with SpliceAI, against the wild type and against the intended allele. It is the clone-level counterpart of the design's splice check. Nothing leaves your computer. The scores are predictions, not measurements; see [docs/CLONE_FLAGS.md](../../docs/CLONE_FLAGS.md) for how Bench uses them.

## Set up

SpliceAI needs Python 3.10 or 3.11:

```bash
python -m venv .venv-spliceai
.venv-spliceai/bin/python -m pip install "numpy<2" tensorflow-cpu==2.15.1 h5py pandas
.venv-spliceai/bin/python -m pip install spliceai --no-deps
```

(The bundled `splice2` conda recipe used for development: `python=3.10`, `numpy=1.26`, `tensorflow-cpu==2.15.1`, `spliceai==1.3.1`.)

## Run

1. In Step 4 of Bench choose **Export SpliceAI request** (`<gene>_clone_splice_request.json`).
2. Check it against the reference record that was uploaded to or fetched by Bench; no model is loaded:

   ```bash
   python tools/spliceai/clone_splice_check.py request.json reference.gb --validate-only
   ```

3. Score it:

   ```bash
   python tools/spliceai/clone_splice_check.py request.json reference.gb -o clone_splice_result.json
   ```

4. In Step 4 choose **Import SpliceAI result**. It is accepted only for the exact request it answers.

The record is identified by its SHA-256 and every edit is checked against it; a different record is refused. SpliceAI runs on a window of at least +-400 bases around the edits (wider when the edits are further apart) with 5,000 bases of context on each side, averaging its five models. A reference shorter than the context is padded with N, as SpliceAI does at the end of a sequence; the result records the number of padded bases and says that the scores then rest on less context.

## What is scored

For every allele: the allele against wild type; for an allele with unwanted edits (unplanned bases, an indel) also those edits alone against wild type and, when the allele carries an intended edit, the allele against the intended allele. The number used for the verdict is the largest absolute change in acceptor or donor probability (gain or loss) in the window, as in the design review: at or below 0.05 supports the clone, at or below 0.2 asks for review, above that advises against. These thresholds are the design review's, not SpliceAI's own (0.2 / 0.5 / 0.8).

An indel is scored the way SpliceAI scores one: deleted positions have no score, inserted bases collapse, with the base that follows them, to their maximum at that base's position.

## Tests

```bash
python -m unittest discover -s tools/spliceai -p 'test_*.py'
```

The tests use a rule-based stand-in for the model (no SpliceAI score appears in them) and check a request exported by Bench against the bundled APOE record (`fixtures/apoe_clone_splice_request.json`, simulated clones; no laboratory data).
