"""Optional local AlphaGenome donor review. No network activity without --run.

Run --validate-only first. A live run retrieves GRCh38 context from Ensembl and
sends reference/intended/full-donor sequences to Google; the API key stays local.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen

OUTPUTS = ("RNA_SEQ", "SPLICE_SITES", "SPLICE_SITE_USAGE")
KEY_PATH = Path(__file__).resolve().parents[2] / "local-reviews" / "alphagenome-api-key.local"


def load_api_key(key_path=KEY_PATH):
    key = os.environ.get("ALPHAGENOME_API_KEY", "").strip()
    if not key and key_path.is_file():
        key = key_path.read_text().strip()
    if not key or any(character.isspace() for character in key):
        raise ValueError("Configure the key with tools/alphagenome/configure_key.py or set ALPHAGENOME_API_KEY locally. Never put it in a VITE variable or tracked project file.")
    return key


def validate_request(request):
    payload = {k: v for k, v in request.items() if k != "requestId"}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    if request.get("schema") != "assured-alphagenome-request/1" or request.get("requestId") != digest:
        raise ValueError("Request schema or SHA-256 does not match. Re-export from Bench.")
    if request.get("assembly") != "GRCh38" or not re.fullmatch(r"chr(?:[1-9]|1\d|2[0-2]|X|Y)", request.get("chromosome", "")):
        raise ValueError("Only human GRCh38 primary chromosomes are supported.")
    length = request.get("sequenceLength")
    if length not in (16384, 131072):
        raise ValueError("Unsupported prediction context length.")
    ref = request.get("reference", {})
    if type(ref.get("start")) is not int or ref["start"] < 1 or not re.fullmatch(r"[ACGTN]{1,1000000}", ref.get("sequence", "")):
        raise ValueError("Invalid chromosome-forward reference.")
    terms = request.get("ontologyTerms")
    if not isinstance(terms, list) or len(terms) != 1 or not re.fullmatch(r"(?:UBERON|CL|EFO):\d+", terms[0]):
        raise ValueError("Supply one AlphaGenome tissue/cell ontology identifier.")
    if request.get("requestedOutputs") != list(OUTPUTS):
        raise ValueError("Unexpected output types.")
    variants = request.get("variants")
    if not isinstance(variants, list) or not 1 <= len(variants) <= 127:
        raise ValueError("Supply 1–127 donor substitutions.")
    seen = set()
    for variant in variants:
        pos = variant.get("position")
        if type(pos) is not int or pos in seen or not ref["start"] <= pos < ref["start"] + len(ref["sequence"]):
            raise ValueError("Variant position is duplicated or outside the uploaded reference.")
        if variant.get("role") not in ("intended", "blocking") or any(not re.fullmatch(r"[ACGT]", variant.get(a, "")) for a in ("ref", "alt")) or variant["ref"] == variant["alt"]:
            raise ValueError("Invalid donor allele or role.")
        if ref["sequence"][pos - ref["start"]] != variant["ref"]:
            raise ValueError("Variant REF does not match the chromosome-forward uploaded sequence.")
        seen.add(pos)
    if not any(v["role"] == "intended" for v in variants) or max(seen) - min(seen) >= length // 2:
        raise ValueError("Missing intended edit or substitutions too far apart.")
    return request


def context_interval(request):
    positions = [v["position"] - 1 for v in request["variants"]]
    center = (min(positions) + max(positions)) // 2
    start = max(0, center - request["sequenceLength"] // 2)
    return start, start + request["sequenceLength"]  # 0-based half-open


def fetch_reference(chromosome, start, end):
    # Ensembl region endpoints are 1-based inclusive; the model interval is not.
    region = f"{chromosome.removeprefix('chr')}:{start + 1}:{end}:1"
    url = f"https://rest.ensembl.org/sequence/region/human/{region}?content-type=text/plain"
    with urlopen(Request(url, headers={"Accept": "text/plain"}), timeout=45) as response:
        return response.read().decode().strip().upper()


def build_sequences(request, context):
    start, end = context_interval(request)
    if len(context) != end - start or not re.fullmatch(r"[ACGTN]+", context):
        raise ValueError("Fetched GRCh38 context has invalid length or sequence.")
    ref = request["reference"]
    # Validate every uploaded reference base overlapping the prediction window,
    # including unedited positions. No silent reference patching or N padding.
    overlap_start = max(start, ref["start"] - 1)
    overlap_end = min(end, ref["start"] - 1 + len(ref["sequence"]))
    uploaded = ref["sequence"][overlap_start - ref["start"] + 1:overlap_end - ref["start"] + 1]
    if context[overlap_start - start:overlap_end - start] != uploaded:
        raise ValueError("Uploaded reference disagrees with GRCh38 context; review assembly, strand and sample variants.")
    intended, full = list(context), list(context)
    for variant in request["variants"]:
        index = variant["position"] - 1 - start
        if not 0 <= index < len(context) or context[index] != variant["ref"]:
            raise ValueError("Variant does not match fetched GRCh38 context.")
        full[index] = variant["alt"]
        if variant["role"] == "intended":
            intended[index] = variant["alt"]
    return {"reference": context, "intended": "".join(intended), "full_donor": "".join(full)}


def compare_tracks(before, after, output_names=OUTPUTS):
    import numpy as np
    rows = []
    for name in output_names:
        a, b = getattr(before, name.lower(), None), getattr(after, name.lower(), None)
        if a is None or b is None:
            raise ValueError(f"Missing {name} predictions for the selected ontology.")
        av, bv = np.asarray(a.values, dtype=float), np.asarray(b.values, dtype=float)
        if av.shape != bv.shape or av.ndim != 2 or not av.shape[1] or not a.metadata.equals(b.metadata) or a.resolution != b.resolution:
            raise ValueError(f"{name} track metadata, resolution or shapes do not match.")
        if not np.isfinite(av).all() or not np.isfinite(bv).all():
            raise ValueError(f"Non-finite {name} predictions.")
        delta = bv - av
        for i in range(av.shape[1]):
            metadata = a.metadata.iloc[i]
            rows.append({
                "output": name, "name": str(metadata.get("name", i)),
                "strand": str(metadata.get("strand", ".")),
                "ontology": str(metadata.get("ontology_curie", "")),
                "resolutionBp": int(a.resolution),
                "meanDelta": float(np.mean(delta[:, i])),
                "meanAbsDelta": float(np.mean(np.abs(delta[:, i]))),
                "maxAbsDelta": float(np.max(np.abs(delta[:, i]))),
            })
    return rows


def run_review(request, client, model_version, sdk_version, reference_fetcher=fetch_reference):
    from alphagenome.data import genome
    from alphagenome.models import dna_client
    start, end = context_interval(request)
    sequences = build_sequences(request, reference_fetcher(request["chromosome"], start, end))
    interval = genome.Interval(chromosome=request["chromosome"], start=start, end=end)
    predictions = {}
    for name, sequence in sequences.items():
        if name == "full_donor" and sequence == sequences["intended"]:
            predictions[name] = predictions["intended"]
        else:
            predictions[name] = client.predict_sequence(
                sequence=sequence, interval=interval,
                requested_outputs=[getattr(dna_client.OutputType, name) for name in OUTPUTS],
                ontology_terms=request["ontologyTerms"],
            )
    pairs = [("reference", "intended"), ("reference", "full_donor"), ("intended", "full_donor")]
    return {
        "schema": "assured-alphagenome-review/1", "requestId": request["requestId"],
        "status": "complete", "evidenceType": "model-prediction",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "modelVersion": model_version, "sdkVersion": sdk_version,
        "assembly": request["assembly"], "chromosome": request["chromosome"],
        "context": {"start": start, "end": end, "convention": "0-based half-open", "sha256": hashlib.sha256(sequences["reference"].encode()).hexdigest()},
        "ontologyTerms": request["ontologyTerms"],
        "comparisons": [{"id": f"{a}_to_{b}", "tracks": compare_tracks(predictions[a], predictions[b])} for a, b in pairs],
        "limitations": [
            "Exploratory raw track differences across the entire selected context; these are not calibrated gene-level variant-effect scores or probabilities.",
            "Metrics have assay-specific units and must not be compared across output types or treated as pathogenicity thresholds.",
            "The full donor is evaluated jointly; differences from intended-only sequence are context-dependent and not additive blocker effects.",
            "Tissue coverage may not match the experimental cell state. No prediction of CRISPR efficiency, HDR yield, protein function, clone fitness or experimental confirmation.",
            "Only substitutions in human GRCh38 are supported. No off-target or personal-genome analysis.",
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
        print(json.dumps({"status": "validated-offline", "requestId": request["requestId"], "interval": context_interval(request), "predictionPerformed": False}))
        return
    if not args.output:
        parser.error("--run requires --output")
    if args.output.exists():
        parser.error("Output already exists; choose a new path to preserve earlier results")
    key = load_api_key()
    from alphagenome.models import dna_client
    # Explicit model enum rather than a changing API default.
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
