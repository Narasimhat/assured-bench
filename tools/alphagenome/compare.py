"""Bounded, matched donor comparisons. JSON on stdin; local key never enters the UI."""
import hashlib
import importlib.metadata
import json
import sys
from datetime import datetime, timezone
import numpy as np
import review


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def validate_batch(batch):
    if batch.get("schema") == "assured-alphagenome-clone-request/1":
        import clones
        return clones.validate_request(batch)
    if batch.get("candidates") and batch["candidates"][0].get("request", {}).get("schema") == "assured-alphagenome-allele-request/1":
        import alleles
        return alleles.validate_batch(batch)
    if batch.get("schema") != "assured-alphagenome-comparison-request/1" or batch.get("requestId") != digest({k: v for k, v in batch.items() if k != "requestId"}):
        raise ValueError("Comparison request identity is invalid.")
    candidates = batch.get("candidates", [])
    if not 1 <= len(candidates) <= 12 or len({c["id"] for c in candidates}) != len(candidates):
        raise ValueError("Choose 1–12 distinct candidate pairs.")
    first = review.validate_request(candidates[0]["request"])
    intended = lambda r: [v for v in r["variants"] if v["role"] == "intended"]
    for c in candidates:
        r = review.validate_request(c["request"])
        if any(r[k] != first[k] for k in ("reference", "assembly", "chromosome", "ontologyTerms", "sequenceLength", "requestedOutputs", "gene")) or intended(r) != intended(first):
            raise ValueError("Candidates must share reference, intended edit, tissue, assays and window.")
    annotation = batch.get("annotation", {})
    if annotation.get("convention") != "0-based half-open" or annotation.get("strand") not in (1, -1):
        raise ValueError("Explicit genomic annotation strand and coordinates are required.")
    exons = annotation.get("exons", [])
    if not 1 <= len(exons) <= 1000 or any(len(e) != 2 or any(type(p) is not int for p in e) or not 0 <= e[0] < e[1] for e in exons):
        raise ValueError("Valid genomic exon intervals are required.")
    if len(annotation.get("splicePositions", [])) > 2000 or any(type(p) is not int or p < 0 for p in annotation.get("splicePositions", [])):
        raise ValueError("Invalid splice boundary coordinates.")
    # One interval for every candidate, anchored only to the intended substitutions.
    positions = [v["position"] - 1 for v in intended(first)]
    start = max(0, (min(positions) + max(positions)) // 2 - first["sequenceLength"] // 2)
    bounds = (start, start + first["sequenceLength"])
    for c in candidates:
        if any(not bounds[0] <= v["position"] - 1 < bounds[1] for v in c["request"]["variants"]):
            raise ValueError("A donor change falls outside the shared prediction interval.")
    return first, bounds


def localized_tracks(before, after, annotation, bounds):
    # Reuse the strict shape, metadata and finite-value validation of the v1 runner.
    review.compare_tracks(before, after)
    start, end = bounds
    strand = "+" if annotation["strand"] == 1 else "-"
    rows = []
    for output in review.OUTPUTS:
        a, b = getattr(before, output.lower()), getattr(after, output.lower())
        av, bv = np.asarray(a.values, dtype=float), np.asarray(b.values, dtype=float)
        if av.shape[0] * a.resolution != end - start:
            raise ValueError("Prediction shape does not cover the requested genomic interval.")
        positions = start + np.arange(av.shape[0]) * a.resolution
        exonic = np.zeros(len(positions), dtype=bool)
        splice = np.zeros(len(positions), dtype=bool)
        for left, right in annotation["exons"]:
            exonic |= (positions >= left) & (positions < right)
        for boundary in annotation["splicePositions"]:
            splice |= (positions >= boundary - 2) & (positions < boundary + 2)
        for i in range(av.shape[1]):
            meta = a.metadata.iloc[i]
            if str(meta.get("strand", ".")) not in (strand, "."):
                continue
            delta = bv[:, i] - av[:, i]
            mask = exonic if output == "RNA_SEQ" else splice if output == "SPLICE_SITE_USAGE" else np.ones(len(positions), dtype=bool)
            top = np.argsort(-np.abs(delta), kind="stable")[:5]
            baseline = float(np.sum(np.abs(av[mask, i]))) if mask.any() else 0
            rows.append({"output": output, "name": str(meta.get("name", i)), "strand": str(meta.get("strand", ".")),
                         "region": "annotated exons" if output == "RNA_SEQ" else "annotated splice boundary ±2 bp" if output == "SPLICE_SITE_USAGE" else "full context (includes cryptic sites)",
                         "regionMaxAbsDelta": float(np.max(np.abs(delta[mask]))) if mask.any() else None,
                         "relativeExonicDelta": float(np.sum(np.abs(delta[mask])) / baseline) if output == "RNA_SEQ" and baseline > 1e-8 else None,
                         "baselineRegionSignal": baseline,
                         "topChanges": [{"position": int(positions[j]) + 1, "before": float(av[j, i]), "after": float(bv[j, i]), "delta": float(delta[j]),
                                         "inAnnotatedExon": bool(exonic[j]), "nearAnnotatedSpliceBoundary": bool(splice[j])} for j in top]})
    return rows


def comparison_metrics(rows, annotation, bounds):
    covered = all(bounds[0] <= a < b <= bounds[1] for a, b in annotation["exons"])
    covered &= all(bounds[0] <= p - 2 < p + 2 <= bounds[1] for p in annotation["splicePositions"])
    def maximum(output, key):
        values = [r[key] for r in rows if r["output"] == output]
        return max(values) if covered and values and all(v is not None for v in values) else None
    return {"annotationFullyCovered": bool(covered),
            "exonicRnaRelativeDelta": maximum("RNA_SEQ", "relativeExonicDelta"),
            "annotatedUsageMaxDelta": maximum("SPLICE_SITE_USAGE", "regionMaxAbsDelta"),
            "spliceSiteMaxDelta": maximum("SPLICE_SITES", "regionMaxAbsDelta")}


def run_batch(batch, client, reference_fetcher=review.fetch_reference, on_progress=None):
    if batch.get("schema") == "assured-alphagenome-clone-request/1":
        import clones
        from local_cache import fetch_context
        actual_fetcher = fetch_context if reference_fetcher is review.fetch_reference else reference_fetcher
        return clones.run_review(batch, client, "ALL_FOLDS", importlib.metadata.version("alphagenome"), reference_fetcher=actual_fetcher, on_progress=on_progress)
    if batch.get("candidates") and batch["candidates"][0].get("request", {}).get("schema") == "assured-alphagenome-allele-request/1":
        import alleles
        from local_cache import fetch_context
        actual_fetcher=fetch_context if reference_fetcher is review.fetch_reference else reference_fetcher
        return alleles.run_batch(batch, client, reference_fetcher=actual_fetcher, on_progress=on_progress)
    from alphagenome.data import genome
    from alphagenome.models import dna_client
    first, bounds = validate_batch(batch)
    context = reference_fetcher(first["chromosome"], *bounds)
    interval = genome.Interval(first["chromosome"], *bounds)
    cache = {}
    def predict(sequence):
        key = hashlib.sha256(sequence.encode()).hexdigest()
        if key not in cache:
            cache[key] = client.predict_sequence(sequence=sequence, interval=interval,
                requested_outputs=[getattr(dna_client.OutputType, n) for n in review.OUTPUTS], ontology_terms=first["ontologyTerms"])
        return cache[key]
    # Validates every overlapping reference base before any predictions are requested.
    sequences = [review.build_sequences(c["request"], context, bounds) for c in batch["candidates"]]
    candidates = []
    for c, seqs in zip(batch["candidates"], sequences):
        try:
            predictions = {name: predict(seq) for name, seq in seqs.items()}
            for prediction in predictions.values():
                for output in ("rna_seq", "splice_site_usage"):
                    track = getattr(prediction, output, None)
                    if track is None or "ontology_curie" not in track.metadata or not set(track.metadata["ontology_curie"]).issubset(set(first["ontologyTerms"])):
                        raise ValueError("Prediction metadata does not match the requested cell context.")
            rows = localized_tracks(predictions["intended"], predictions["full_donor"], batch["annotation"], bounds)
            pairs = [("reference", "intended"), ("reference", "full_donor"), ("intended", "full_donor")]
            candidates.append({"id": c["id"], "requestId": c["request"]["requestId"], "status": "complete",
                "metrics": comparison_metrics(rows, batch["annotation"], bounds), "localizedTracks": rows,
                "comparisons": [{"id": f"{a}_to_{b}", "tracks": review.compare_tracks(predictions[a], predictions[b])} for a, b in pairs]})
        except Exception as error:
            # Provider errors may carry credential metadata; only expose the class.
            candidates.append({"id": c["id"], "requestId": c["request"]["requestId"], "status": "failed", "error": f"Prediction unavailable ({type(error).__name__}); no clean result inferred."})
        if on_progress:
            on_progress(len(candidates))
    return {"schema": "assured-alphagenome-comparison/1", "requestId": batch["requestId"], "sourceId": batch["sourceId"],
            "createdAt": datetime.now(timezone.utc).isoformat(), "modelVersion": "ALL_FOLDS", "sdkVersion": importlib.metadata.version("alphagenome"),
            "ontologyTerms": first["ontologyTerms"], "annotation": batch["annotation"],
            "context": {"start": bounds[0], "end": bounds[1], "convention": "0-based half-open", "sha256": hashlib.sha256(context.encode()).hexdigest()},
            "candidates": candidates, "uniqueSequencePredictions": len(cache),
            "limitations": ["Comparative exploratory evidence, not calibrated safety or pathogenicity thresholds.",
                "Intended mutation effects remain separate; only additional blocker-associated effects inform the comparison.",
                "Missing coverage, low baseline expression and failed predictions prevent a complete preference.",
                "No genome-wide specificity, HDR efficiency, protein-function or disease-phenotype assessment."]}


def main():
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", nargs="?", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    batch = json.loads(args.request.read_text() if args.request else sys.stdin.read(2500000))
    validate_batch(batch)
    if args.output and args.output.exists():
        raise ValueError("Choose a new output file; earlier evidence is preserved.")
    from alphagenome.models import dna_client
    client = dna_client.create(review.load_api_key(), model_version=dna_client.ModelVersion.ALL_FOLDS, timeout=90)
    from local_cache import run_cached
    result = run_cached(batch, client, run_batch)
    data = json.dumps(result, allow_nan=False)
    if args.output:
        args.output.write_text(data + "\n")
        print(f"Comparison saved: {args.output}")
    else:
        print(data)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": f"Comparison failed ({type(error).__name__}). Check the mapped reference, annotations, API access and selected context."}))
        sys.exit(1)
