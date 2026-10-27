"""AlphaGenome comparison of several substitution donors (research use).

One request holds the intended edit, several donor alleles (the intended edit plus each
candidate's silent blockers), and one to four cell contexts. The tool predicts the reference,
the intended-edit-only allele and every donor allele once, in all contexts per call, and
compares each donor with the intended-edit-only allele inside the annotated gene. It also
builds, or loads, a null: random synonymous blocker sets of the same size near the edit, so a
donor's effect can be read against what any silent change of that size does.

No network activity without --run or --serve. A live run retrieves GRCh38 context from
Ensembl and sends sequences to Google; the API key stays local (see review.py).
Run --validate-only first. --serve starts the local helper the Bench page uses (see helper.py).
"""
import argparse
import hashlib
import importlib.metadata
import json
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
except ImportError:  # --validate-only needs no numerical stack
    np = None

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run from any directory
import review as single  # same directory: Ensembl context fetch and key loading

SCHEMA_REQUEST = "assured-alphagenome-candidates-request/1"
SCHEMA_REPORT = "assured-alphagenome-ranking/1"
SCHEMA_NULL = "assured-alphagenome-null/1"
METRICS_VERSION = 1
OUTPUTS = ("RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE")
MAX_ALLELES = 12
MAX_CONTEXTS = 4
SPLICE_TOLERANCE = 3
CODONS = {}
for _i, (_a, _b, _c) in enumerate((a, b, c) for a in "TCAG" for b in "TCAG" for c in "TCAG"):
    CODONS[_a + _b + _c] = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"[_i]


def canonical_digest(payload):
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()


def validate_request(request):
    payload = {k: v for k, v in request.items() if k != "requestId"}
    if request.get("schema") != SCHEMA_REQUEST or request.get("requestId") != canonical_digest(payload):
        raise ValueError("Request schema or SHA-256 does not match. Re-export from Bench.")
    if request.get("assembly") != "GRCh38" or not re.fullmatch(r"chr(?:[1-9]|1\d|2[0-2]|X|Y)", request.get("chromosome", "")):
        raise ValueError("Only human GRCh38 primary chromosomes are supported.")
    length = request.get("sequenceLength")
    if length not in (16384, 131072):
        raise ValueError("Unsupported prediction context length.")
    ref = request.get("reference", {})
    if type(ref.get("start")) is not int or ref["start"] < 1 or not re.fullmatch(r"[ACGTN]{1,1000000}", ref.get("sequence", "")):
        raise ValueError("Invalid chromosome-forward reference.")
    contexts = request.get("contexts")
    if not isinstance(contexts, list) or not 1 <= len(contexts) <= MAX_CONTEXTS or len(set(contexts)) != len(contexts) \
            or any(not re.fullmatch(r"(?:UBERON|CL|EFO):\d+", c) for c in contexts):
        raise ValueError("Supply one to four distinct AlphaGenome tissue/cell ontology identifiers.")
    if request.get("requestedOutputs") != list(OUTPUTS):
        raise ValueError("Unexpected output types.")
    ann = request.get("annotation", {})
    if ann.get("strand") != "+":
        raise ValueError("Only genes on the plus strand of a chromosome-forward reference are supported.")
    end_ref = ref["start"] + len(ref["sequence"]) - 1
    gs, ge = ann.get("geneStart"), ann.get("geneEnd")
    if type(gs) is not int or type(ge) is not int or not ref["start"] <= gs < ge <= end_ref:
        raise ValueError("Gene body must lie inside the uploaded reference.")
    for key in ("exons", "cdsSegments"):
        spans = ann.get(key)
        if not isinstance(spans, list) or not spans or any(
                not (isinstance(s, list) and len(s) == 2 and all(type(x) is int for x in s) and gs <= s[0] <= s[1] <= ge) for s in spans):
            raise ValueError(f"Annotation {key} must be integer [start, end] spans inside the gene body.")
    intended = request.get("intended")
    alleles = request.get("alleles")
    if not isinstance(intended, list) or not 1 <= len(intended) <= 3:
        raise ValueError("Supply one to three intended substitutions.")
    if not isinstance(alleles, list) or not 1 <= len(alleles) <= MAX_ALLELES or len({a.get("id") for a in alleles}) != len(alleles):
        raise ValueError(f"Supply one to {MAX_ALLELES} donor alleles with distinct ids.")

    def check_variant(v):
        pos = v.get("position")
        if type(pos) is not int or not ref["start"] <= pos <= end_ref:
            raise ValueError("Variant position is outside the uploaded reference.")
        if not re.fullmatch(r"[ACGT]", v.get("ref", "")) or not re.fullmatch(r"[ACGT]", v.get("alt", "")) or v["ref"] == v["alt"]:
            raise ValueError("Invalid variant alleles.")
        if ref["sequence"][pos - ref["start"]] != v["ref"]:
            raise ValueError("Variant REF does not match the chromosome-forward uploaded sequence.")
    for v in intended:
        check_variant(v)
    want = {(v["position"], v["alt"]) for v in intended}
    for allele in alleles:
        positions = set()
        for v in allele.get("variants", []):
            check_variant(v)
            if v["position"] in positions:
                raise ValueError("Duplicate variant position in an allele.")
            positions.add(v["position"])
        got = {(v["position"], v["alt"]) for v in allele.get("variants", []) if v.get("role") == "intended"}
        if got != want or any(v.get("role") not in ("intended", "blocking") for v in allele["variants"]):
            raise ValueError("Every allele must carry exactly the intended substitutions plus blocking changes.")
    spec = request.get("null", {})
    if not (isinstance(spec.get("ks"), list) and spec["ks"] and all(type(k) is int and 1 <= k <= 3 for k in spec["ks"]) and spec["ks"] == sorted(set(spec["ks"]))):
        raise ValueError("Null block counts must be a sorted list within 1-3.")
    if type(spec.get("perK")) is not int or not 10 <= spec["perK"] <= 100 or type(spec.get("windowBp")) is not int or not 10 <= spec["windowBp"] <= 100 or type(spec.get("seed")) is not int:
        raise ValueError("Invalid null specification.")
    start0, end0 = context_interval(request)
    if start0 < 0 or not (start0 < gs - 1 and ge <= end0):
        raise ValueError("The gene body must fit inside the prediction window around the intended edit.")
    return request


def context_interval(request):
    """0-based half-open window centred on the first intended substitution."""
    centre = min(v["position"] for v in request["intended"]) - 1
    start = centre - request["sequenceLength"] // 2
    return start, start + request["sequenceLength"]


def _require_numpy():
    if np is None:
        raise ImportError("numpy is required for predictions and metrics; install tools/alphagenome/requirements.txt.")


def gene_geometry(request):
    """Gene-body slice in context coordinates plus exon and splice-site masks in gene-body coordinates."""
    _require_numpy()
    ann = request["annotation"]
    start0, _ = context_interval(request)
    gs, ge = ann["geneStart"], ann["geneEnd"]
    length = ge - gs + 1
    body = slice(gs - 1 - start0, ge - start0)
    exon_idx = np.concatenate([np.arange(a - gs, b - gs + 1) for a, b in ann["exons"]])
    donors = [b - gs for a, b in ann["exons"][:-1]]
    acceptors = [a - gs for a, b in ann["exons"][1:]]
    annotated = np.zeros(length, bool)
    for i in donors + acceptors:
        annotated[max(0, i - SPLICE_TOLERANCE): i + SPLICE_TOLERANCE + 1] = True
    return {"body": body, "exon_idx": exon_idx, "annotated": annotated, "length": length, "start": gs}


# ---- tracks and metrics --------------------------------------------------------------------------

def extract_tracks(out, body, contexts):
    """Gene-body arrays: RNA-seq and splice-site usage per context (plus strand), donor and acceptor probabilities."""
    def pick(track, predicate):
        meta, values = track.metadata, np.asarray(track.values, dtype=np.float32)
        for i in range(values.shape[1]):
            row = meta.iloc[i]
            if predicate(row):
                return values[body, i].copy()
        raise ValueError("The prediction is missing a requested track.")
    result = {"rna": {}, "usage": {}}
    for c in contexts:
        result["rna"][c] = pick(out.rna_seq, lambda r, c=c: str(r.get("ontology_curie", "")) == c and str(r.get("strand", "")) == "+")
        result["usage"][c] = pick(out.splice_site_usage, lambda r, c=c: str(r.get("ontology_curie", "")) == c and str(r.get("strand", "")) == "+")
    result["donor"] = pick(out.splice_sites, lambda r: str(r.get("name", "")).lower() == "donor" and str(r.get("strand", "")) == "+")
    result["acceptor"] = pick(out.splice_sites, lambda r: str(r.get("name", "")).lower() == "acceptor" and str(r.get("strand", "")) == "+")
    return result


def metric_names(context):
    return [f"M1_expr_log2|{context}", f"M2_local_rel|{context}", f"M5_usage_annot|{context}", "M3_splice_annot_loss", "M4_new_site_gain"]


def compute_metrics(allele, intended, reference, span, geo, contexts):
    """Metrics for one allele against the intended-edit-only allele, restricted to the annotated gene body.

    span: (min, max) gene-body index of the substituted bases."""
    out = {}
    lo, hi = max(0, span[0] - 50), min(geo["length"], span[1] + 51)
    exon, annotated = geo["exon_idx"], geo["annotated"]
    for c in contexts:
        a, i, r = allele["rna"][c], intended["rna"][c], reference["rna"][c]
        out[f"M1_expr_log2|{c}"] = float(abs(np.log2((a[exon].sum() + 1) / (i[exon].sum() + 1))))
        out[f"M2_local_rel|{c}"] = float(np.abs(a[lo:hi] - i[lo:hi]).mean() / (r[lo:hi].mean() + 0.1))
        out[f"M5_usage_annot|{c}"] = float(np.abs(allele["usage"][c] - intended["usage"][c])[annotated].max())
    d = np.stack([allele["donor"] - intended["donor"], allele["acceptor"] - intended["acceptor"]])
    out["M3_splice_annot_loss"] = float(np.abs(d[:, annotated]).max())
    out["M4_new_site_gain"] = float(max(0.0, d[:, ~annotated].max()))
    return out


# ---- null alleles --------------------------------------------------------------------------------

def null_sets(request):
    """Random sets of single-base synonymous changes in distinct codons near the intended edit.

    Deterministic for a given request: codons are enumerated in chromosome order and drawn with a seeded generator."""
    ref, ann, spec = request["reference"], request["annotation"], request["null"]
    seq = ref["sequence"]
    centre = min(v["position"] for v in request["intended"])
    protected = {v["position"] for v in request["intended"]}
    cds = []
    for s, e in sorted(ann["cdsSegments"]):
        cds.extend(range(s, e + 1))
    starts = {}
    for offset in range(0, len(cds) - 2, 3):
        triple = cds[offset: offset + 3]
        if triple[2] - triple[0] == 2:  # codon inside one segment
            starts[triple[0]] = triple
    window = spec["windowBp"]
    near = {}
    for position in range(centre - window, centre + window + 1):
        for first, triple in starts.items():
            if position in triple:
                near[first] = triple
    options = []
    for first in sorted(near):
        triple = near[first]
        if protected & set(triple):
            continue
        codon = "".join(seq[p - ref["start"]] for p in triple)
        if codon not in CODONS or CODONS[codon] == "*":
            continue
        choices = []
        for j in range(3):
            for base in "ACGT":
                if base != codon[j] and CODONS[codon[:j] + base + codon[j + 1:]] == CODONS[codon]:
                    choices.append((triple[j], codon[j], base))
        if choices:
            options.append(choices)
    rng = random.Random(spec["seed"])
    sets = []
    for k in spec["ks"]:
        if len(options) < k:
            raise ValueError("Too few synonymous codons near the edit to build the null.")
        for n in range(spec["perK"]):
            picked = rng.sample(range(len(options)), k)
            sets.append({"k": k, "n": n, "variants": sorted(rng.choice(options[c]) for c in picked)})
    return sets, len(options)


def null_key(request, model_version, reference_context_sha):
    start0, end0 = context_interval(request)
    return canonical_digest({
        "schema": SCHEMA_NULL, "chromosome": request["chromosome"], "window": [start0, end0], "contextSha256": reference_context_sha,
        "contexts": request["contexts"], "intended": request["intended"], "null": request["null"], "annotation": request["annotation"],
        "metricsVersion": METRICS_VERSION, "modelVersion": model_version,
    })


# ---- prediction ----------------------------------------------------------------------------------

class Predictor:
    """Thin wrapper so tests can inject a fake client without the SDK."""
    def __init__(self, client, outputs=None, interval_factory=None):
        self.client = client
        self.outputs = outputs
        self.interval_factory = interval_factory

    def __call__(self, sequence, chromosome, start0, end0, contexts):
        if self.interval_factory:
            interval = self.interval_factory(chromosome, start0, end0)
        else:
            from alphagenome.data import genome
            interval = genome.Interval(chromosome=chromosome, start=start0, end=end0)
        outputs = self.outputs
        if outputs is None:
            from alphagenome.models import dna_client
            outputs = [getattr(dna_client.OutputType, n) for n in OUTPUTS]
        return self.client.predict_sequence(sequence=sequence, interval=interval, requested_outputs=outputs, ontology_terms=contexts)


def apply_variants(context, start0, variants):
    seq = list(context)
    for v in variants:
        index = v[0] - 1 - start0
        if seq[index] != v[1]:
            raise ValueError("Variant does not match the fetched GRCh38 context.")
        seq[index] = v[2]
    return "".join(seq)


def validate_context(request, context):
    start0, end0 = context_interval(request)
    if len(context) != end0 - start0 or not re.fullmatch(r"[ACGTN]+", context):
        raise ValueError("Fetched GRCh38 context has invalid length or sequence.")
    ref = request["reference"]
    lo, hi = max(start0, ref["start"] - 1), min(end0, ref["start"] - 1 + len(ref["sequence"]))
    if context[lo - start0:hi - start0] != ref["sequence"][lo - ref["start"] + 1:hi - ref["start"] + 1]:
        raise ValueError("Uploaded reference disagrees with GRCh38 context; review assembly, strand and sample variants.")


def build_null(request, predict, context, intended_tracks, reference_tracks, geo, workers=4):
    start0, end0 = context_interval(request)
    sets, n_codons = null_sets(request)
    intended = [(v["position"], v["ref"], v["alt"]) for v in request["intended"]]

    def work(item):
        variants = intended + item["variants"]
        out = None
        for attempt in range(3):
            try:
                out = predict(apply_variants(context, start0, variants), request["chromosome"], start0, end0, request["contexts"])
                break
            except Exception:  # transient service errors; never echo them (they can carry request metadata)
                time.sleep(2 * (attempt + 1))
        if out is None:
            raise RuntimeError("A null prediction failed after three attempts.")
        tracks = extract_tracks(out, geo["body"], request["contexts"])
        span = (min(v[0] for v in variants) - geo["start"], max(v[0] for v in variants) - geo["start"])
        return {"k": item["k"], "n": item["n"], "variants": [list(v) for v in item["variants"]],
                "metrics": compute_metrics(tracks, intended_tracks, reference_tracks, span, geo, request["contexts"])}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        alleles = list(pool.map(work, sets))
    return {"perK": request["null"]["perK"], "ks": request["null"]["ks"], "windowBp": request["null"]["windowBp"],
            "seed": request["null"]["seed"], "codonsAvailable": n_codons, "alleles": alleles}


def run_ranking(request, predict, context, model_version, sdk_version, null_store=None, workers=4):
    start0, end0 = context_interval(request)
    geo = gene_geometry(request)
    contexts = request["contexts"]
    intended = [(v["position"], v["ref"], v["alt"]) for v in request["intended"]]
    context_sha = hashlib.sha256(context.encode()).hexdigest()
    key = null_key(request, model_version, context_sha)

    def tracks_of(variants):
        out = predict(apply_variants(context, start0, variants), request["chromosome"], start0, end0, contexts)
        return extract_tracks(out, geo["body"], contexts)
    reference_tracks = tracks_of([])
    intended_tracks = tracks_of(intended)
    repeat = tracks_of(intended)
    drift = max(float(np.abs(intended_tracks[k][c] - repeat[k][c]).max()) for k in ("rna", "usage") for c in contexts)
    drift = max(drift, *(float(np.abs(intended_tracks[k] - repeat[k]).max()) for k in ("donor", "acceptor")))
    null = None
    if null_store is not None and null_store.get("nullKey") == key:
        null = null_store["null"]
    elif null_store is not None and null_store.get("nullKey") not in (None, key):
        raise ValueError("The cached null was built for a different locus, window, context set, reference or model. Rebuild it.")
    if null is None:
        null = build_null(request, predict, context, intended_tracks, reference_tracks, geo, workers)
    results = []
    for allele in request["alleles"]:
        variants = [(v["position"], v["ref"], v["alt"]) for v in allele["variants"]]
        tracks = tracks_of(variants)
        span = (min(v[0] for v in variants) - geo["start"], max(v[0] for v in variants) - geo["start"])
        results.append({"id": allele["id"], "metrics": compute_metrics(tracks, intended_tracks, reference_tracks, span, geo, contexts)})
    edit_span = (min(v[0] for v in intended) - geo["start"], max(v[0] for v in intended) - geo["start"])
    ref_signal = {c: {"exonMeanPlus": float(reference_tracks["rna"][c][geo["exon_idx"]].mean()), "geneMeanPlus": float(reference_tracks["rna"][c].mean())} for c in contexts}
    report = {
        "schema": SCHEMA_REPORT, "requestId": request["requestId"], "status": "complete", "evidenceType": "model-prediction",
        "createdAt": datetime.now(timezone.utc).isoformat(), "modelVersion": model_version, "sdkVersion": sdk_version,
        "metricsVersion": METRICS_VERSION, "assembly": request["assembly"], "chromosome": request["chromosome"],
        "context": {"start": start0, "end": end0, "convention": "0-based half-open", "sha256": context_sha},
        "contexts": contexts, "nullKey": key, "determinismMaxAbsDiff": drift, "referenceSignal": ref_signal,
        "alleles": results, "intendedVsReference": compute_metrics(intended_tracks, reference_tracks, reference_tracks, edit_span, geo, contexts),
        "null": null,
        "limitations": [
            "Exploratory comparisons against random synonymous changes of the same size; not calibrated variant-effect scores or probabilities.",
            "Metrics are restricted to the annotated gene body and use plus-strand tracks; units are assay-specific and not comparable across outputs.",
            "The model sees only the substituted allele, never the guide or the donor arms; donors with the same substitution set are identical to it.",
            "No prediction of cutting efficiency, HDR yield, protein function, clone fitness or off-target effects.",
        ],
    }
    return report, {"schema": SCHEMA_NULL, "nullKey": key, "null": null}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", type=Path, nargs="?")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate-only", action="store_true", help="Validate locally; no SDK, key or network required")
    mode.add_argument("--run", action="store_true", help="Retrieve Ensembl context and send sequences to the AlphaGenome API")
    mode.add_argument("--serve", action="store_true", help="Run the local helper the Bench page talks to (127.0.0.1 only)")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--null", type=Path, dest="null_path", help="Null cache; built and written here when missing")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--port", type=int, default=8765, help="--serve: port (default 8765)")
    parser.add_argument("--origin", action="append", default=[], help="--serve: an extra page origin to allow, e.g. https://my-bench.example")
    parser.add_argument("--token", help="--serve: fixed session code instead of a random one")
    parser.add_argument("--null-dir", type=Path, help="--serve: where computed nulls are cached")
    args = parser.parse_args()
    if args.serve:
        import helper
        helper.serve(port=args.port, origins=args.origin, token=args.token, null_dir=args.null_dir or helper.NULL_DIR)
        return
    if not args.request:
        parser.error("a request file is required")
    request = validate_request(json.loads(args.request.read_text()))
    if args.validate_only:
        start0, end0 = context_interval(request)
        sets, n_codons = null_sets(request)
        print(json.dumps({"status": "validated-offline", "requestId": request["requestId"], "interval": [start0, end0],
                          "alleles": len(request["alleles"]), "contexts": request["contexts"], "nullAlleles": len(sets), "codonsAvailable": n_codons,
                          "predictionPerformed": False}))
        return
    if not args.output or not args.null_path:
        parser.error("--run requires --output and --null")
    if args.output.exists():
        parser.error("Output already exists; choose a new path to preserve earlier results")
    key = single.load_api_key()
    from alphagenome.models import dna_client
    model_version = dna_client.ModelVersion.ALL_FOLDS
    client = dna_client.create(key, model_version=model_version)
    start0, end0 = context_interval(request)
    context = single.fetch_reference(request["chromosome"], start0, end0).upper()
    validate_context(request, context)
    store = json.loads(args.null_path.read_text()) if args.null_path.exists() else None
    report, new_store = run_ranking(request, Predictor(client), context, model_version.name, importlib.metadata.version("alphagenome"), store, args.workers)
    if store is None:
        args.null_path.write_text(json.dumps(new_store, indent=1, allow_nan=False) + "\n")
    args.output.write_text(json.dumps(report, indent=1, allow_nan=False) + "\n")
    print(f"Ranking report saved to {args.output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # gRPC error text can include request/credential metadata; never echo it.
        if isinstance(error, (ValueError, FileNotFoundError, json.JSONDecodeError, ImportError)):
            print(f"Ranking failed: {error}", file=sys.stderr)
        else:
            print(f"Ranking failed ({type(error).__name__}). No completed report was written. Check connectivity, ontology coverage and API access.", file=sys.stderr)
        sys.exit(1)
