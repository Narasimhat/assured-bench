"""Offline tests for rank.py. The fake prediction client below is a test fixture that makes the
plumbing checkable (windows, masks, null construction, caching); its numbers are not model output
and are never reported as results."""
import copy
import json
import random
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

import rank

ROOT = Path(__file__).resolve().parents[2]
CONTEXTS = ["CL:0000679", "EFO:0009747"]


def toy_request(perk=10, ks=(1, 2), strand="+"):
    rng = random.Random(7)
    pos = 9100 + 3 * 17  # a codon start inside the CDS
    ctx_start0 = pos - 1 - 8192  # 0-based start of the 16,384 bp window centred on the intended edit
    context = "".join(rng.choice("ACGT") for _ in range(16384))
    ref_start = 9000
    ref_seq = context[ref_start - 1 - ctx_start0: ref_start - 1 - ctx_start0 + 700]
    # CDS: codon-aligned segment 9100-9399 (300 bp), exons around it
    ann = {"strand": strand, "geneStart": 9000, "geneEnd": 9699, "exons": [[9000, 9199], [9300, 9399], [9500, 9699]], "cdsSegments": [[9100, 9199], [9300, 9399]]}
    ref_base = ref_seq[pos - ref_start]
    alt = "A" if ref_base != "A" else "C"
    request = {
        "schema": rank.SCHEMA_REQUEST, "gene": "TOY", "assembly": "GRCh38", "chromosome": "chr1",
        "reference": {"start": ref_start, "sequence": ref_seq}, "annotation": ann, "contexts": list(CONTEXTS),
        "intended": [{"position": pos, "ref": ref_base, "alt": alt}], "sequenceLength": 16384,
        "requestedOutputs": list(rank.OUTPUTS), "null": {"perK": perk, "ks": list(ks), "windowBp": 35, "seed": 11},
        "alleles": [],
    }
    # two donor alleles: intended edit plus one or two blockers (synonymous changes are not required for plumbing tests)
    def variant(p, role, alt_base=None):
        r = ref_seq[p - ref_start]
        a = alt_base or ("T" if r != "T" else "G")
        return {"position": p, "ref": r, "alt": a, "role": role}
    intended = {"position": pos, "ref": ref_base, "alt": alt, "role": "intended"}
    request["alleles"] = [{"id": "alleleA", "variants": [intended, variant(pos + 6, "blocking")]},
                          {"id": "alleleB", "variants": [intended, variant(pos - 6, "blocking"), variant(pos + 9, "blocking")]}]
    request["requestId"] = rank.canonical_digest({k: v for k, v in request.items()})
    return request, context


class FakeClient:
    """Deterministic stand-in: exon RNA level 20, +0.5 around every base that differs from the reference context."""
    def __init__(self, request, context):
        self.request, self.context, self.calls = request, context, 0
        self.start0, self.end0 = rank.context_interval(request)

    def predict_sequence(self, sequence, interval, requested_outputs, ontology_terms):
        self.calls += 1
        length = len(sequence)
        diff = np.array([a != b for a, b in zip(sequence, self.context)])
        bump = np.convolve(diff.astype(float), np.ones(5), mode="same") * 0.5
        gs = self.request["annotation"]["geneStart"] - 1 - self.start0
        base = np.ones(length)
        for a, b in self.request["annotation"]["exons"]:
            base[a - 1 - self.start0: b - self.start0] = 20.0
        geo = rank.gene_geometry(self.request)
        sites = np.zeros(length)
        for i in np.flatnonzero(geo["annotated"]):
            sites[gs + i] = 1.0
        def table(values, rows):
            return SimpleNamespace(values=np.stack(values, axis=1), metadata=pd.DataFrame(rows))
        rna_rows, rna_vals = [], []
        for c in ontology_terms:
            for strand in "+-":
                rna_rows.append({"name": f"{c} total RNA-seq", "strand": strand, "ontology_curie": c}); rna_vals.append(base + (bump if strand == "+" else 0))
        use_rows, use_vals = [], []
        for c in ontology_terms:
            for strand in "+-":
                use_rows.append({"name": f"usage_{c} total RNA-seq", "strand": strand, "ontology_curie": c}); use_vals.append(sites * 0.5 - (bump * 0.001 if strand == "+" else 0))
        ss_rows = [{"name": n, "strand": s, "ontology_curie": ""} for n in ("donor", "acceptor") for s in "+-"]
        ss_vals = [sites - bump * 0.002 for _ in ss_rows]
        return SimpleNamespace(rna_seq=table(rna_vals, rna_rows), splice_site_usage=table(use_vals, use_rows), splice_sites=table(ss_vals, ss_rows))


def run_toy(request, context, store=None):
    client = FakeClient(request, context)
    predict = rank.Predictor(client, outputs=list(rank.OUTPUTS), interval_factory=lambda chrom, s, e: (chrom, s, e))
    start0, _ = rank.context_interval(request)
    rank.validate_context(request, context)
    return client, rank.run_ranking(request, predict, context, "FAKE", "0", store, workers=2)


class RequestValidation(unittest.TestCase):
    def test_valid_request_passes_and_tampering_fails(self):
        request, _ = toy_request()
        rank.validate_request(request)
        bad = copy.deepcopy(request); bad["alleles"][0]["variants"][1]["alt"] = "T" if bad["alleles"][0]["variants"][1]["ref"] != "T" else "G"
        bad["alleles"][0]["variants"][1]["alt"] = "A" if bad["alleles"][0]["variants"][1]["alt"] != "A" else "C"
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            rank.validate_request(bad)

    def test_structural_errors(self):
        def reseal(r):
            r.pop("requestId", None); r["requestId"] = rank.canonical_digest(r); return r
        request, _ = toy_request()
        minus = reseal(copy.deepcopy(request)); minus["annotation"]["strand"] = "-"; reseal(minus)
        with self.assertRaisesRegex(ValueError, "plus strand"):
            rank.validate_request(minus)
        missing = copy.deepcopy(request); missing["alleles"][0]["variants"] = missing["alleles"][0]["variants"][1:]; reseal(missing)
        with self.assertRaisesRegex(ValueError, "intended"):
            rank.validate_request(missing)
        wrongref = copy.deepcopy(request); v = wrongref["alleles"][0]["variants"][1]; v["ref"] = "A" if v["ref"] != "A" else "C"; reseal(wrongref)
        with self.assertRaisesRegex(ValueError, "REF"):
            rank.validate_request(wrongref)
        many = copy.deepcopy(request); many["contexts"] = ["CL:0000001", "CL:0000002", "CL:0000003", "CL:0000004", "CL:0000005"]; reseal(many)
        with self.assertRaisesRegex(ValueError, "one to four"):
            rank.validate_request(many)
        far = copy.deepcopy(request); far["annotation"]["geneEnd"] = 9699 + 20000; far["reference"]["sequence"] = far["reference"]["sequence"]; reseal(far)
        with self.assertRaises(ValueError):
            rank.validate_request(far)


class NullConstruction(unittest.TestCase):
    def test_deterministic_and_counts(self):
        request, _ = toy_request(perk=12, ks=(1, 2))
        a, n_codons = rank.null_sets(request); b, _ = rank.null_sets(request)
        self.assertEqual(a, b)
        self.assertEqual(len(a), 24)
        self.assertGreater(n_codons, 4)
        for s in a:
            self.assertEqual(len(s["variants"]), s["k"])
            codons = {(p - 9100) // 3 for p, _, _ in s["variants"]}
            self.assertEqual(len(codons), s["k"], "distinct codons")
            for p, ref, alt in s["variants"]:
                self.assertEqual(request["reference"]["sequence"][p - 9000], ref)
                codon_first = 9100 + 3 * ((p - 9100) // 3)
                before = request["reference"]["sequence"][codon_first - 9000: codon_first - 9000 + 3]
                after = before[:p - codon_first] + alt + before[p - codon_first + 1:]
                self.assertEqual(rank.CODONS[before], rank.CODONS[after], "synonymous")

    def test_apoe_null_sets_match_the_prototype_run(self):
        gb = (ROOT / "public/references/apoe-ensg00000130203.gb").read_text()
        seq = "".join(re.findall(r"[A-Za-z]+", re.sub(r"[0-9\s/]", "", gb.split("\nORIGIN")[-1]))).upper()
        join = re.search(r"CDS\s+join\(([^)]*)\)", gb).group(1)
        start = 44905754
        cds = [[start - 1 + int(a), start - 1 + int(b)] for a, b in (x.split("..") for x in join.split(","))]
        request = {"reference": {"start": start, "sequence": seq}, "annotation": {"cdsSegments": cds},
                   "intended": [{"position": 44908822, "ref": "C", "alt": "T"}], "null": {"perK": 30, "ks": [1, 2, 3], "windowBp": 35, "seed": 20261027}}
        sets, n_codons = rank.null_sets(request)
        expected = json.loads((ROOT / "test/fixtures/alphagenome-ranking/apoe-r176c-null-sets.json").read_text())["sets"]
        self.assertEqual(n_codons, 23)
        self.assertEqual([{"k": s["k"], "n": s["n"], "variants": [list(v) for v in s["variants"]]} for s in sets], expected)


class RunWithFakeClient(unittest.TestCase):
    def test_report_structure_and_monotone_fake_effect(self):
        request, context = toy_request(perk=10, ks=(1, 2))
        client, (report, store) = run_toy(request, context)
        self.assertEqual(report["schema"], rank.SCHEMA_REPORT)
        self.assertEqual(report["requestId"], request["requestId"])
        self.assertEqual(report["determinismMaxAbsDiff"], 0.0)
        self.assertEqual([a["id"] for a in report["alleles"]], ["alleleA", "alleleB"])
        self.assertEqual(len(report["null"]["alleles"]), 20)
        names = set(rank.metric_names("CL:0000679") + rank.metric_names("EFO:0009747"))
        self.assertEqual(set(report["alleles"][0]["metrics"]), names)
        for context_id in CONTEXTS:
            self.assertAlmostEqual(report["referenceSignal"][context_id]["exonMeanPlus"], 20.0, places=3)
        a, b = (x["metrics"]["M2_local_rel|CL:0000679"] for x in report["alleles"])
        self.assertGreater(b, a, "two blockers perturb more than one in the fake model")
        self.assertEqual(store["nullKey"], report["nullKey"])
        # reference + intended + repeat + 2 alleles + 20 null alleles
        self.assertEqual(client.calls, 3 + 2 + 20)

    def test_cached_null_is_reused_and_a_stale_one_is_refused(self):
        request, context = toy_request(perk=10, ks=(1, 2))
        _, (_, store) = run_toy(request, context)
        client, (report, _) = run_toy(request, context, store)
        self.assertEqual(client.calls, 3 + 2)
        self.assertEqual(report["null"], store["null"])
        stale = dict(store); stale["nullKey"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "cached null"):
            run_toy(request, context, stale)

    def test_context_mismatch_with_uploaded_reference_is_refused(self):
        request, context = toy_request()
        flipped = list(context); index = 9050 - 1 - rank.context_interval(request)[0]; flipped[index] = "A" if flipped[index] != "A" else "C"
        with self.assertRaisesRegex(ValueError, "disagrees"):
            rank.validate_context(request, "".join(flipped))

    def test_metric_m4_is_never_negative(self):
        request, context = toy_request()
        geo = rank.gene_geometry(request)
        zeros = {"rna": {c: np.zeros(geo["length"]) for c in CONTEXTS}, "usage": {c: np.zeros(geo["length"]) for c in CONTEXTS}, "donor": np.zeros(geo["length"]), "acceptor": np.zeros(geo["length"])}
        lower = copy.deepcopy(zeros); lower["donor"] -= 0.3
        m = rank.compute_metrics(lower, zeros, zeros, (100, 100), geo, CONTEXTS)
        self.assertEqual(m["M4_new_site_gain"], 0.0)


if __name__ == "__main__":
    unittest.main()
