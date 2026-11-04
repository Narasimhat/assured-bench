"""Contract tests for the clone SpliceAI runner. The predictor is replaced by a small rule-based stand-in: nothing here is a SpliceAI score."""
import copy
import hashlib
import json
import unittest
from pathlib import Path
import numpy as np
import clone_splice_check as cs

FLANK = 12


def fake_predictor(flank=FLANK):
    """Acceptor probability 1 where the window has AG (at the A), donor probability 1 where it has GT (at the G): a stand-in with a clear answer."""
    def predict(window):
        core = window[flank:len(window) - flank]
        out = np.zeros((len(core), 3))
        for i in range(len(core)):
            pair = window[flank + i:flank + i + 2]
            if pair == "AG": out[i, 1] = 1
            if pair == "GT": out[i, 2] = 1
        out[:, 0] = 1 - out[:, 1] - out[:, 2]
        return out
    return predict


SEQUENCE = ("ACCTTCCA" * 40)[:300]
QUIET = SEQUENCE.index("TTCC", 150) + 2      # a CC with a T before it: GT there makes a donor site and no acceptor site


def make_request(alleles, intended=None, strand=1, window=60):
    body = {
        "schema": cs.SCHEMA_REQUEST, "gene": "TEST", "referenceFile": "t.gb",
        "reference": {"length": len(SEQUENCE), "sha256": hashlib.sha256(SEQUENCE.encode()).hexdigest(), "convention": "0-based half-open indices into the record as uploaded"},
        "geneStrand": strand, "window": window, "thresholds": {"pass": 0.05, "review": 0.2},
        "intended": intended or [], "alleles": alleles,
    }
    body["requestId"] = cs.digest(body)
    return body


def edit(start, end, inserted, role, sequence=SEQUENCE):
    return {"start": start, "end": end, "ref": sequence[start:end], "inserted": inserted, "role": role}


class CloneSpliceTests(unittest.TestCase):
    def test_a_request_is_checked_against_its_digest_and_its_reference(self):
        request = make_request([{"id": "A1", "label": "x", "intendedId": None, "unwanted": True, "edits": [edit(150, 151, "G", "unplanned")], "clones": []}])
        self.assertIs(cs.validate_request(request, SEQUENCE), request)
        tampered = copy.deepcopy(request); tampered["alleles"][0]["edits"][0]["inserted"] = "T"
        with self.assertRaisesRegex(ValueError, "SHA-256"): cs.validate_request(tampered)
        with self.assertRaisesRegex(ValueError, "not the one"): cs.validate_request(request, SEQUENCE[:-1] + "A")
        wrong = copy.deepcopy(request); wrong["alleles"][0]["edits"][0]["ref"] = "T" if SEQUENCE[150] != "T" else "A"; wrong["requestId"] = cs.digest({k: v for k, v in wrong.items() if k != "requestId"})
        with self.assertRaisesRegex(ValueError, "does not have"): cs.validate_request(wrong, SEQUENCE)
        with self.assertRaisesRegex(ValueError, "not a clone splice request"): cs.validate_request({"schema": "x"})

    def test_a_substitution_that_makes_a_donor_site_is_a_donor_gain_and_nothing_else_moves(self):
        at = QUIET
        request = make_request([{"id": "A1", "label": "x", "intendedId": None, "unwanted": True, "edits": [edit(at, at + 2, "GT", "unplanned")], "clones": []}])
        scored = cs.score_request(request, SEQUENCE, fake_predictor(), flank=FLANK)
        row = scored["scores"][0]
        self.assertEqual(row["comparison"], "allele vs wild type")
        self.assertEqual(row["donorGain"], 1.0)
        self.assertEqual(row["acceptorGain"], 0.0)
        self.assertEqual(scored["summary"]["alleles"]["A1"]["unwantedEffectMax"], 1.0, "no intended partner: the whole effect is the unwanted one")
        self.assertEqual(scored["contextPaddedBases"], 0)

    def test_unwanted_edits_are_judged_on_top_of_the_intended_allele(self):
        at = QUIET
        intended = [{"id": "D1", "name": "ssODN1", "edits": [edit(at + 20, at + 21, "A" if SEQUENCE[at + 20] != "A" else "C", "intended")]}]
        request = make_request([
            {"id": "A1", "label": "intended as read", "intendedId": "D1", "unwanted": False, "edits": [intended[0]["edits"][0]], "clones": []},
            {"id": "A2", "label": "with an unplanned base", "intendedId": "D1", "unwanted": True, "edits": [intended[0]["edits"][0], edit(at, at + 2, "GT", "unplanned")], "clones": []},
        ], intended=intended)
        scored = cs.score_request(request, SEQUENCE, fake_predictor(), flank=FLANK)
        rows = scored["summary"]["alleles"]
        self.assertIsNone(rows["A1"]["unwantedEffectMax"])
        self.assertEqual(rows["A2"]["unwantedEffectMax"], 1.0)
        self.assertEqual([s["comparison"] for s in scored["scores"] if s["allele"] == "A2"], ["allele vs wild type", "unwanted edits only vs wild type", "allele vs intended allele"])

    def test_a_reverse_strand_gene_is_scored_in_its_own_orientation(self):
        # on the reverse strand the stand-in sees the reverse complement: CT>AC read forward is GT>AG... use a change whose reverse complement makes AG
        at = QUIET
        forward = cs.score_request(make_request([{"id": "A1", "label": "x", "intendedId": None, "unwanted": True, "edits": [edit(at, at + 2, "CT", "unplanned")], "clones": []}], strand=1), SEQUENCE, fake_predictor(), flank=FLANK)
        reverse = cs.score_request(make_request([{"id": "A1", "label": "x", "intendedId": None, "unwanted": True, "edits": [edit(at, at + 2, "CT", "unplanned")], "clones": []}], strand=-1), SEQUENCE, fake_predictor(), flank=FLANK)
        self.assertEqual(reverse["scores"][0]["acceptorGain"], 1.0, "CT on the forward strand is AG on the reverse strand")
        self.assertEqual(forward["scores"][0]["acceptorGain"], 0.0)

    def test_an_indel_is_aligned_to_the_reference_not_compared_base_for_base(self):
        # a deletion far from any AG or GT motif must not look like a splice change just because everything downstream shifted by one
        quiet = SEQUENCE.index("ACCTTCCA", 100)
        request = make_request([{"id": "A1", "label": "-1", "intendedId": None, "unwanted": True, "edits": [edit(quiet + 2, quiet + 3, "", "indel")], "clones": []}])
        scored = cs.score_request(request, SEQUENCE, fake_predictor(), flank=FLANK)
        self.assertEqual(scored["scores"][0]["max"], 0.0)
        # an insertion that creates AG shows up as an acceptor gain at the position it lands on
        request = make_request([{"id": "A1", "label": "+AG", "intendedId": None, "unwanted": True, "edits": [edit(quiet + 4, quiet + 4, "AG", "indel", SEQUENCE)], "clones": []}])
        scored = cs.score_request(request, SEQUENCE, fake_predictor(), flank=FLANK)
        self.assertEqual(scored["scores"][0]["acceptorGain"], 1.0)

    def test_align_to_reference_conventions(self):
        alt = np.arange(1, 13, dtype=float).reshape(4, 3) * 0.01 + 0.01          # 4 rows
        # deletion of the base at 1 in a 5-base core: row 1 is zero, the others keep their rows
        out = cs.align_to_reference(alt, [{"start": 1, "end": 2, "inserted": ""}], 0, 5)
        self.assertTrue((out[1] == 0).all()); self.assertTrue((out[0] == alt[0]).all()); self.assertTrue((out[2] == alt[1]).all()); self.assertTrue((out[4] == alt[3]).all())
        # insertion of two bases before base 1 in a 3-base core: alt has 5 rows; the inserted pair and the base after them share base 1's position
        alt5 = np.arange(1, 16, dtype=float).reshape(5, 3)
        out = cs.align_to_reference(alt5, [{"start": 1, "end": 1, "inserted": "AC"}], 0, 3)
        self.assertTrue((out[0] == alt5[0]).all()); self.assertTrue((out[1] == alt5[1:4].max(axis=0)).all()); self.assertTrue((out[2] == alt5[4]).all())

    def test_a_reference_shorter_than_the_context_is_padded_and_the_result_says_so(self):
        request = make_request([{"id": "A1", "label": "x", "intendedId": None, "unwanted": True, "edits": [edit(10, 11, "G", "unplanned")], "clones": []}])
        scored = cs.score_request(request, SEQUENCE, fake_predictor(), flank=FLANK)
        self.assertGreater(scored["contextPaddedBases"], 0)
        result = cs.build_result(request, scored, "1.3.1")
        self.assertEqual(result["schema"], cs.SCHEMA_RESULT)
        self.assertEqual(result["requestId"], request["requestId"])
        self.assertIn("padded with N", result["note"])
        json.dumps(result, allow_nan=False)

    def test_a_request_exported_by_the_app_is_valid_for_the_bundled_apoe_record(self):
        fixture = Path(__file__).parent / "fixtures" / "apoe_clone_splice_request.json"
        record = Path(__file__).resolve().parents[2] / "public" / "references" / "apoe-ensg00000130203.gb"
        request = json.loads(fixture.read_text())
        self.assertIs(cs.validate_request(request, cs.read_genbank_sequence(record)), request)


if __name__ == "__main__":
    unittest.main()
