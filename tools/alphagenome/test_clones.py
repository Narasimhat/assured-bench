"""Local contract tests for the clone AlphaGenome review. All model predictions and reference fetches are mocked; the SDK is not needed."""
import copy
import hashlib
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pandas as pd
import clones
import review


def seal(request):
    request = {k: v for k, v in request.items() if k != "requestId"}
    request["requestId"] = clones.digest(request)
    return request


def edit(reference, start, end, inserted, role, origin=1000):
    ref = reference[start - origin:end - origin]
    if inserted and inserted == ref:      # an edit must change the base: take another one
        inserted = {"A": "C", "C": "G", "G": "T", "T": "A"}[ref]
    return {"start": start, "end": end, "ref": ref, "inserted": inserted, "role": role}


SEQUENCE = ("ACGTTGCA" * 40)[:300]


def request_payload():
    d1 = {"id": "D1", "name": "ssODN1", "edits": [edit(SEQUENCE, 1100, 1101, "T", "intended"), edit(SEQUENCE, 1110, 1111, "C", "blocking")]}
    alleles = [
        {"id": "A1", "label": "intended as read", "intendedId": "D1", "unwanted": False, "edits": d1["edits"], "clones": [{"name": "c1"}]},
        {"id": "A2", "label": "with an unplanned base", "intendedId": "D1", "unwanted": True, "edits": d1["edits"] + [edit(SEQUENCE, 1130, 1131, "G" if SEQUENCE[130] != "G" else "A", "unplanned")], "clones": [{"name": "c2"}]},
        {"id": "A3", "label": "-3", "intendedId": None, "unwanted": True, "edits": [edit(SEQUENCE, 1105, 1108, "", "indel")], "clones": [{"name": "c3"}]},
        {"id": "A4", "label": "+AC", "intendedId": None, "unwanted": True, "edits": [edit(SEQUENCE, 1120, 1120, "AC", "indel")], "clones": [{"name": "c4"}]},
    ]
    return seal({"schema": clones.SCHEMA_REQUEST, "assembly": "GRCh38", "chromosome": "chr17", "gene": "TEST", "reference": {"start": 1001, "sequence": SEQUENCE},
                 "sequenceLength": 16384, "ontologyTerms": ["CL:0000000"], "requestedOutputs": list(review.OUTPUTS), "intended": [d1], "alleles": alleles})


def tracks(sequence):
    """A prediction that depends on the sequence: one track per output whose single value is the number of G in the first 2000 bases."""
    metadata = pd.DataFrame({"name": ["t"], "strand": ["+"], "ontology_curie": ["CL:0000000"]})
    track = SimpleNamespace(values=np.array([[sequence[:2000].count("G")], [0.0]], dtype=float), metadata=metadata, resolution=1)
    return SimpleNamespace(**{name.lower(): track for name in review.OUTPUTS})


class FakeSdk:
    class genome:
        class Interval:
            def __init__(self, chromosome, start, end): self.chromosome, self.start, self.end = chromosome, start, end
    class dna_client:
        OutputType = SimpleNamespace(**{name: name for name in review.OUTPUTS})


class CloneAlphaGenomeTests(unittest.TestCase):
    def test_a_request_is_checked_for_digest_reference_and_geometry(self):
        request = request_payload()
        self.assertIs(clones.validate_request(request), request)
        for mutate, message in [
            (lambda r: r["alleles"][0]["edits"][0].update(inserted="G"), "SHA-256"),
        ]:
            broken = copy.deepcopy(request); mutate(broken)
            with self.assertRaisesRegex(ValueError, message): clones.validate_request(broken)
        wrong = copy.deepcopy(request); wrong["alleles"][2]["edits"][0]["ref"] = "TTT"
        with self.assertRaisesRegex(ValueError, "does not match the reference"): clones.validate_request(seal(wrong))
        noop = copy.deepcopy(request); noop["alleles"][0]["edits"][0]["inserted"] = noop["alleles"][0]["edits"][0]["ref"]
        with self.assertRaisesRegex(ValueError, "change the sequence"): clones.validate_request(seal(noop))
        dup = copy.deepcopy(request); dup["alleles"][1]["id"] = "A1"
        with self.assertRaisesRegex(ValueError, "unique"): clones.validate_request(seal(dup))
        unknown = copy.deepcopy(request); unknown["alleles"][0]["intendedId"] = "D9"
        with self.assertRaisesRegex(ValueError, "not in the request"): clones.validate_request(seal(unknown))
        overlap = copy.deepcopy(request); overlap["alleles"][1]["edits"].append(edit(SEQUENCE, 1100, 1101, "C", "unplanned"))
        with self.assertRaisesRegex(ValueError, "sorted, non-overlapping"): clones.validate_request(seal(overlap))

    def test_sequences_are_built_over_one_window_with_the_right_length(self):
        request = clones.validate_request(request_payload())
        start, end = clones.context_interval(request)
        extra = clones.extra_bases(request)
        self.assertEqual(extra, 3, "the deletion needs three extra bases fetched")
        # a context that agrees with the uploaded reference where they overlap
        ctx = list("A" * (end + extra - start))
        for i, base in enumerate(SEQUENCE):
            j = 1000 + i - start
            if 0 <= j < len(ctx): ctx[j] = base
        sequences = clones.build_sequences(request, "".join(ctx))
        self.assertEqual({len(s) for s in sequences.values()}, {16384})
        base = 1100 - start
        self.assertEqual(sequences["D1"][base], request["intended"][0]["edits"][0]["inserted"])
        self.assertNotEqual(sequences["D1"][base], sequences["reference"][base])
        self.assertEqual(sequences["A2"][1130 - start], request["alleles"][1]["edits"][-1]["inserted"])
        self.assertEqual(sequences["A1"], sequences["D1"], "the intended allele as read is the intended allele")
        deletion = sequences["A3"]; ref = sequences["reference"]
        self.assertEqual(deletion[:1105 - start], ref[:1105 - start])
        self.assertEqual(deletion[1105 - start:], "".join(ctx)[1108 - start:1108 - start + len(deletion) - (1105 - start)], "the bases after a deletion move up; the far flank is read from the extra bases")
        insertion = sequences["A4"]
        self.assertEqual(insertion[1120 - start:1122 - start], "AC")
        self.assertEqual(insertion[:1120 - start], ref[:1120 - start])
        bad = list(ctx); bad[1050 - start] = "G" if bad[1050 - start] != "G" else "T"
        with self.assertRaisesRegex(ValueError, "disagrees"): clones.build_sequences(request, "".join(bad))
        with self.assertRaisesRegex(ValueError, "invalid length"): clones.build_sequences(request, "".join(ctx)[:-1])

    def test_run_predicts_each_distinct_sequence_once_and_compares_with_reference_and_intended(self):
        request = request_payload()
        start, end = clones.context_interval(request)
        calls = []

        class Client:
            def predict_sequence(self, **kwargs):
                calls.append(kwargs)
                return tracks(kwargs["sequence"])

        def fetch(chromosome, s, e):
            ctx = list("A" * (e - s))
            for i, base in enumerate(SEQUENCE):
                j = 1000 + i - s
                if 0 <= j < len(ctx): ctx[j] = base
            return "".join(ctx)

        report = clones.run_review(request, Client(), "ALL_FOLDS", "test", fetch, sdk=FakeSdk)
        self.assertEqual(report["schema"], clones.SCHEMA_REPORT)
        self.assertEqual(report["requestId"], request["requestId"])
        self.assertEqual(len(calls), 5, "reference, intended (shared with A1), A2, A3, A4")
        self.assertEqual(calls[0]["interval"].end - calls[0]["interval"].start, 16384)
        self.assertEqual(calls[0]["ontology_terms"], ["CL:0000000"])
        self.assertEqual([c["id"] for c in report["alleles"][0]["comparisons"]], ["reference_to_allele", "intended_to_allele"])
        self.assertEqual([c["id"] for c in report["alleles"][2]["comparisons"]], ["reference_to_allele"], "no intended partner: only the reference comparison")
        self.assertEqual(report["intended"][0]["comparison"]["id"], "reference_to_intended")
        json.dumps(report, allow_nan=False)
        # the comparison reflects the stand-in's rule: the unplanned G changes the count against the intended allele
        a2 = report["alleles"][1]["comparisons"][1]["tracks"][0]
        self.assertEqual(a2["output"], "RNA_SEQ")

    def test_a_request_exported_by_the_app_validates(self):
        fixture = Path(__file__).parent / "fixtures" / "apoe_clone_alphagenome_request.json"
        request = json.loads(fixture.read_text())
        self.assertIs(clones.validate_request(request), request)
        start, end = clones.context_interval(request)
        self.assertEqual(end - start, request["sequenceLength"])


if __name__ == "__main__":
    unittest.main()
