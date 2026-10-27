"""Build a compact context-coverage catalog from AlphaGenome output metadata.

Use --metadata-file for offline regeneration, or --refresh to query the API with
its locally configured key. This never sends a DNA sequence or performs inference.
"""
import argparse
import importlib.metadata
import json
from datetime import datetime, timezone
from pathlib import Path

DEFINITIONS = Path(__file__).with_name("context_panel.json")
OUTPUTS = ("rna_seq", "cage", "procap", "dnase", "atac", "chip_histone", "chip_tf",
           "splice_sites", "splice_site_usage", "splice_junctions", "contact_maps")


def build_catalog(metadata, definitions):
    if metadata.get("schema") != "assured-alphagenome-metadata/1" or metadata.get("organism") != "HOMO_SAPIENS":
        raise ValueError("A human AlphaGenome metadata snapshot is required.")
    contexts = []
    seen = set()
    for definition in definitions:
        if definition["id"] in seen:
            raise ValueError("Duplicate context identifier.")
        seen.add(definition["id"])
        counts, biosamples, sources, assay_sources = {}, set(), set(), {}
        modifications = {"modified": 0, "unmodified": 0, "unknown": 0}
        for output, rows in metadata["outputs"].items():
            matching = [row for row in rows if row.get("ontology_curie") == definition["ontology"]]
            if matching:
                counts[output.upper()] = len(matching)
                assay_sources[output.upper()] = {
                    "biosampleNames": sorted({row["biosample_name"] for row in matching if row.get("biosample_name")}),
                    "biosampleTypes": sorted({row["biosample_type"] for row in matching if row.get("biosample_type")}),
                    "sourceLifeStageLabels": sorted({row["biosample_life_stage"] for row in matching if row.get("biosample_life_stage")}),
                    "dataSources": sorted({row["data_source"] for row in matching if row.get("data_source")}),
                }
                for row in matching:
                    if row.get("biosample_name"):
                        biosamples.add(row["biosample_name"])
                    if row.get("data_source"):
                        sources.add(row["data_source"])
                    flag = row.get("genetically_modified")
                    modifications["modified" if flag is True else "unmodified" if flag is False else "unknown"] += 1
        contexts.append({**definition, "available": bool(counts), "outputTracks": counts,
                         "biosampleNames": sorted(biosamples), "sources": sorted(sources), "assaySources": assay_sources,
                         "geneticModificationMetadata": modifications,
                         "experimentalMatchVerified": False})
    return {"schema": "assured-alphagenome-context-catalog/1", "organism": "HOMO_SAPIENS",
            "modelVersion": metadata.get("modelVersion"), "sdkVersion": metadata.get("sdkVersion"),
            "retrievedAt": metadata.get("retrievedAt"),
            "source": "AlphaGenome output_metadata API", "contexts": contexts,
            "sharedOutputs": {"SPLICE_SITES": len(metadata["outputs"].get("splice_sites", []))},
            "limitations": [
                "Model tracks are not independent biological replicates.",
                "A shared ontology does not establish that all assays represent the same source sample or cell state.",
                "Shared splice-site tracks are not cell-specific splicing evidence.",
                "A lineage/tissue proxy is not a verified match to a PSC-derived population or maturation stage.",
                "Donor life-stage metadata does not establish differentiation state.",
            ]}


def refresh_metadata():
    from alphagenome.models import dna_client
    from review import load_api_key
    client = dna_client.create(load_api_key(), model_version=dna_client.ModelVersion.ALL_FOLDS, timeout=30)
    metadata = client.output_metadata(organism=dna_client.Organism.HOMO_SAPIENS)
    outputs = {}
    for name in OUTPUTS:
        frame = getattr(metadata, name, None)
        if frame is not None:
            outputs[name] = frame.astype(object).where(frame.notnull(), None).to_dict(orient="records")
    return {"schema": "assured-alphagenome-metadata/1", "organism": "HOMO_SAPIENS",
            "modelVersion": "ALL_FOLDS", "sdkVersion": importlib.metadata.version("alphagenome"),
            "retrievedAt": datetime.now(timezone.utc).isoformat(), "outputs": outputs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--metadata-file", type=Path)
    mode.add_argument("--refresh", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    metadata = refresh_metadata() if args.refresh else json.loads(args.metadata_file.read_text())
    catalog = build_catalog(metadata, json.loads(DEFINITIONS.read_text()))
    args.output.write_text(json.dumps(catalog, indent=2, allow_nan=False) + "\n")
    print(f"Context catalog saved: {len(catalog['contexts'])} contexts; no sequence predictions performed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Provider error strings can carry credential metadata. Report only the exception class.
        raise SystemExit(f"Context catalog failed ({type(error).__name__}); provider details suppressed.")
