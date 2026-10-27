"""Local contract tests. All model predictions and reference fetches are mocked."""
import copy
import hashlib
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
import stat
import numpy as np
import pandas as pd
import review
from configure_key import save_key


def request_payload():
    data = {
        "schema": "assured-alphagenome-request/1", "gene": "TEST", "assembly": "GRCh38",
        "chromosome": "chr17", "donor": "donor0", "reference": {"start": 100000, "sequence": "A" * 250},
        "variants": [{"position": 100100, "ref": "A", "alt": "T", "role": "intended"}, {"position": 100110, "ref": "A", "alt": "C", "role": "blocking"}],
        "ontologyTerms": ["CL:0000000"], "sequenceLength": 16384, "requestedOutputs": list(review.OUTPUTS),
    }
    data["requestId"] = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return data


def tracks(value):
    from alphagenome.data.track_data import TrackData
    metadata = pd.DataFrame({"name": ["test track"], "strand": ["+"], "ontology_curie": ["CL:0000000"]})
    track = TrackData(values=np.array([[value], [value + 1]], dtype=np.float32), metadata=metadata, resolution=1)
    return SimpleNamespace(**{name.lower(): track for name in review.OUTPUTS})


class ReviewTests(unittest.TestCase):
    def test_local_key_file_is_private_and_environment_takes_precedence(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "private" / "key.local"
            save_key("fake-test-key", path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with patch.dict("os.environ", {"ALPHAGENOME_API_KEY": ""}):
                self.assertEqual(review.load_api_key(path), "fake-test-key")
            with patch.dict("os.environ", {"ALPHAGENOME_API_KEY": "fake-env-key"}):
                self.assertEqual(review.load_api_key(path), "fake-env-key")
            with self.assertRaises(ValueError): save_key("", path)
            self.assertEqual(path.read_text().strip(), "fake-test-key")

    def test_context_and_joint_donor(self):
        request = review.validate_request(request_payload())
        start, end = review.context_interval(request)
        seqs = review.build_sequences(request, "A" * (end - start))
        first, second = (v["position"] - 1 - start for v in request["variants"])
        self.assertEqual(seqs["intended"][first], "T")
        self.assertEqual(seqs["intended"][second], "A")
        self.assertEqual(seqs["full_donor"][second], "C")
        self.assertEqual(len(seqs["full_donor"]), 16384)

    def test_mismatch_and_corrupt_digest_fail_before_prediction(self):
        request = request_payload()
        broken = copy.deepcopy(request)
        broken["variants"][0]["ref"] = "G"
        with self.assertRaises(ValueError): review.validate_request(broken)
        start, end = review.context_interval(request)
        context = list("A" * (end - start))
        context[request["reference"]["start"] - 1 - start] = "G"  # unedited position
        with self.assertRaisesRegex(ValueError, "disagrees"): review.build_sequences(request, "".join(context))

    def test_real_sdk_contract_with_mock_predictions(self):
        request = request_payload()
        calls = []

        class Client:
            def predict_sequence(self, **kwargs):
                calls.append(kwargs)
                return tracks(float(len(calls)))

        result = review.run_review(request, Client(), "ALL_FOLDS", "test", lambda chrom, start, end: "A" * (end - start))
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0]["interval"].end - calls[0]["interval"].start, 16384)
        self.assertEqual(calls[0]["ontology_terms"], request["ontologyTerms"])
        self.assertEqual([o.name for o in calls[0]["requested_outputs"]], list(review.OUTPUTS))
        self.assertEqual(result["comparisons"][2]["id"], "intended_to_full_donor")
        self.assertEqual(result["comparisons"][2]["tracks"][0]["meanAbsDelta"], 1)
        self.assertEqual(result["comparisons"][1]["tracks"][0]["maxAbsDelta"], 2)

    def test_track_errors_do_not_become_clean_bill_of_health(self):
        a, b = tracks(1), tracks(2)
        b.rna_seq = None
        with self.assertRaisesRegex(ValueError, "Missing"): review.compare_tracks(a, b)
        a, b = tracks(1), tracks(float("nan"))
        with self.assertRaisesRegex(ValueError, "Non-finite"): review.compare_tracks(a, b)


if __name__ == "__main__":
    unittest.main()
