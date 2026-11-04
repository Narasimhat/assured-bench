"""Optional local AlphaGenome review of the alleles of a clone (the clone-level counterpart of review.py and alleles.py). No network activity without --run.

The design review predicts the planned edit. This predicts what the clone was found to carry: the intended allele as read, any base the design did not plan and any indel allele,
against the reference and against the intended allele. Run --validate-only first. A live run retrieves GRCh38 context from Ensembl and sends the sequences to Google; the API key stays local.
"""
import argparse
import hashlib
import importlib.metadata
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import review

SCHEMA_REQUEST = "assured-alphagenome-clone-request/1"
SCHEMA_REPORT = "assured-alphagenome-clone-review/1"
CONTEXT_LENGTHS = (16384, 131072, 524288, 1048576)
ROLES = ("intended", "blocking", "unplanned", "indel")


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def validate_request(request):
    """Raise ValueError for anything that is not exactly what the app exports; every edit is checked against the uploaded reference."""
    if request.get("schema") != SCHEMA_REQUEST or request.get("requestId") != digest({k: v for k, v in request.items() if k != "requestId"}):
        raise ValueError("Request schema or SHA-256 does not match. Re-export from Bench.")
    if request.get("assembly") != "GRCh38" or not re.fullmatch(r"chr(?:[1-9]|1\d|2[0-2]|X|Y)", request.get("chromosome", "")):
        raise ValueError("Only human GRCh38 primary chromosomes are supported.")
    ref = request.get("reference", {})
    length = request.get("sequenceLength")
    if type(ref.get("start")) is not int or ref["start"] < 1 or not re.fullmatch("[ACGTN]{1,1000000}", ref.get("sequence", "")) or length not in CONTEXT_LENGTHS:
        raise ValueError("Invalid reference or context.")
    terms = request.get("ontologyTerms")
    if not isinstance(terms, list) or len(terms) != 1 or not re.fullmatch(r"(?:UBERON|CL|EFO):\d+", terms[0]):
        raise ValueError("Supply one AlphaGenome tissue/cell ontology identifier.")
    if request.get("requestedOutputs") != list(review.OUTPUTS):
        raise ValueError("Unexpected output types.")
    intended = request.get("intended", [])
    alleles = request.get("alleles", [])
    if not isinstance(alleles, list) or not 1 <= len(alleles) <= 24 or not isinstance(intended, list) or len(intended) > 24:
        raise ValueError("Supply 1-24 alleles.")
    ids = {d.get("id") for d in intended}
    if len(ids) != len(intended):
        raise ValueError("Intended allele identifiers must be unique.")
    first, last = ref["start"] - 1, ref["start"] - 1 + len(ref["sequence"])
    seen = set()
    for item in intended + alleles:
        edits = item.get("edits")
        if not isinstance(edits, list) or not 1 <= len(edits) <= 12:
            raise ValueError("An allele must have 1-12 edits.")
        end_before = -1
        for e in edits:
            a, b = e.get("start"), e.get("end")
            if type(a) is not int or type(b) is not int or not first <= a <= b <= last or a < end_before or (a == b and not e.get("inserted")):
                raise ValueError("Edits must be sorted, non-overlapping and inside the uploaded reference.")
            if not re.fullmatch("[ACGT]*", e.get("inserted", "")) or e.get("role") not in ROLES or max(b - a, len(e["inserted"])) > length // 4:
                raise ValueError("Invalid or oversized edit.")
            if ref["sequence"][a - first:b - first] != e.get("ref"):
                raise ValueError(f"Edit at {a + 1} does not match the reference.")
            if e["inserted"] == e["ref"]:
                raise ValueError("An edit must change the sequence.")
            end_before = b
    for a in alleles:
        if not re.fullmatch(r"A\d+", a.get("id", "")) or a["id"] in seen:
            raise ValueError("Allele identifiers must be unique.")
        seen.add(a["id"])
        if a.get("intendedId") is not None and a["intendedId"] not in ids:
            raise ValueError("An allele refers to an intended allele that is not in the request.")
    every = [e for item in intended + alleles for e in item["edits"]]
    lo, hi = min(e["start"] for e in every), max(e["end"] for e in every)
    if hi - lo >= length // 2:
        raise ValueError("The edits are too far apart for the selected prediction context.")
    return request


def net_deletion(edits):
    return sum(max(0, (e["end"] - e["start"]) - len(e["inserted"])) for e in edits)


def extra_bases(request):
    """Bases fetched beyond the window so that every edited sequence can be cut back to the window length."""
    return max([net_deletion(i["edits"]) for i in request.get("intended", []) + request["alleles"]] + [0])


def context_interval(request):
    every = [e for item in request.get("intended", []) + request["alleles"] for e in item["edits"]]
    centre = (min(e["start"] for e in every) + max(e["end"] for e in every)) // 2
    start = max(0, centre - request["sequenceLength"] // 2)
    return start, start + request["sequenceLength"]  # 0-based half-open


def apply_edits(context, start, edits, length):
    out = context
    for e in sorted(edits, key=lambda e: e["start"], reverse=True):
        out = out[:e["start"] - start] + e["inserted"] + out[e["end"] - start:]
    if len(out) < length:
        raise ValueError("Incomplete edited context.")
    return out[:length]


def build_sequences(request, context, bounds=None):
    """reference, each intended allele (D1...) and each clone allele (A1...) over the same window; insertions crop the far flank, deletions use the extra bases fetched."""
    start, end = bounds or context_interval(request)
    length = end - start
    if len(context) != length + extra_bases(request) or not re.fullmatch("[ACGTN]+", context):
        raise ValueError("Fetched GRCh38 context has invalid length or sequence.")
    ref = request["reference"]
    lo, hi = max(start, ref["start"] - 1), min(start + len(context), ref["start"] - 1 + len(ref["sequence"]))
    if context[lo - start:hi - start] != ref["sequence"][lo - ref["start"] + 1:hi - ref["start"] + 1]:
        raise ValueError("Uploaded reference disagrees with GRCh38 context; review assembly, strand and sample variants.")
    sequences = {"reference": context[:length]}
    for item in request.get("intended", []) + request["alleles"]:
        for e in item["edits"]:
            if context[e["start"] - start:e["end"] - start] != e["ref"]:
                raise ValueError("An edit does not match the fetched GRCh38 context.")
        sequences[item["id"]] = apply_edits(context, start, item["edits"], length)
    return sequences


def run_review(request, client, model_version, sdk_version, reference_fetcher=review.fetch_reference, sdk=None, on_progress=None):
    if sdk is None:
        from alphagenome.data import genome
        from alphagenome.models import dna_client
    else:
        genome, dna_client = sdk.genome, sdk.dna_client
    start, end = context_interval(request)
    sequences = build_sequences(request, reference_fetcher(request["chromosome"], start, end + extra_bases(request)), (start, end))
    interval = genome.Interval(chromosome=request["chromosome"], start=start, end=end)
    predictions, by_sequence = {}, {}
    for idx, (name, sequence) in enumerate(sequences.items(), 1):
        if sequence not in by_sequence:
            by_sequence[sequence] = client.predict_sequence(
                sequence=sequence, interval=interval,
                requested_outputs=[getattr(dna_client.OutputType, o) for o in review.OUTPUTS], ontology_terms=request["ontologyTerms"])
        predictions[name] = by_sequence[sequence]
        if on_progress:
            on_progress(min(len(request["alleles"]), idx))
    compare = lambda a, b: {"tracks": review.compare_tracks(predictions[a], predictions[b])}
    alleles = []
    for a in request["alleles"]:
        comparisons = [{"id": "reference_to_allele", **compare("reference", a["id"])}]
        if a.get("intendedId") is not None:
            comparisons.append({"id": "intended_to_allele", **compare(a["intendedId"], a["id"])})
        alleles.append({"id": a["id"], "intendedId": a.get("intendedId"), "comparisons": comparisons})
    return {
        "schema": SCHEMA_REPORT, "requestId": request["requestId"], "status": "complete", "evidenceType": "model-prediction",
        "createdAt": datetime.now(timezone.utc).isoformat(), "modelVersion": model_version, "sdkVersion": sdk_version,
        "assembly": request["assembly"], "chromosome": request["chromosome"],
        "context": {"start": start, "end": end, "convention": "0-based half-open", "sha256": hashlib.sha256(sequences["reference"].encode()).hexdigest()},
        "ontologyTerms": request["ontologyTerms"],
        "intended": [{"id": d["id"], "comparison": {"id": "reference_to_intended", **compare("reference", d["id"])}} for d in request.get("intended", [])],
        "alleles": alleles,
        "limitations": [
            "Exploratory raw track differences across the entire selected context; these are not calibrated gene-level variant-effect scores or probabilities.",
            "Metrics have assay-specific units and must not be compared across output types or treated as pathogenicity thresholds.",
            "A heterozygous base cannot be placed on one allele from a Sanger trace; the review assumes an unplanned base sits on the allele that carries the intended edit.",
            "Tissue coverage may not match the experimental cell state. No prediction of CRISPR efficiency, protein function, clone fitness or experimental confirmation.",
            "Only human GRCh38 is supported. No off-target or personal-genome analysis.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate-only", action="store_true", help="Validate locally; no SDK, key or network required")
    mode.add_argument("--run", action="store_true", help="Retrieve Ensembl context and send sequences to the AlphaGenome API")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    request = validate_request(json.loads(args.request.read_text()))
    if args.validate_only:
        print(json.dumps({"status": "validated-offline", "requestId": request["requestId"], "interval": context_interval(request), "alleles": len(request["alleles"]), "predictionPerformed": False}))
        return
    if not args.output:
        parser.error("--run requires --output")
    if args.output.exists():
        parser.error("Output already exists; choose a new path to preserve earlier results")
    key = review.load_api_key()
    from alphagenome.models import dna_client
    model_version = dna_client.ModelVersion.ALL_FOLDS
    client = dna_client.create(key, model_version=model_version)
    result = run_review(request, client, model_version.name, importlib.metadata.version("alphagenome"))
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(f"Review saved to {args.output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # gRPC error text can include request/credential metadata; never echo it.
        if isinstance(error, (ValueError, FileNotFoundError, json.JSONDecodeError, ImportError)):
            print(f"Review failed: {error}", file=sys.stderr)
        else:
            print(f"Review failed ({type(error).__name__}). No completed report was written. Check connectivity, ontology coverage and API access.", file=sys.stderr)
        sys.exit(1)
