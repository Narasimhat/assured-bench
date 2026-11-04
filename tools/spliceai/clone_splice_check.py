#!/usr/bin/env python3
"""Optional SpliceAI review of the alleles of a clone (the clone-level counterpart of the design's splice check).

The design review scores the edit that was planned. This scores what the clone was found to carry: the alleles read from its Sanger traces (the intended edit as read,
any base the design did not plan, any indel allele), against the wild type and against the intended allele. Nothing leaves your computer.

  python clone_splice_check.py request.json reference.gb [-o clone_splice_result.json] [--window 400] [--validate-only]

request.json  the "clone splice request" exported by the app (schema assured-clone-splice-request/1)
reference.gb  the GenBank record that was uploaded to or fetched by the app (it is identified by its SHA-256; a different record is refused)

Needs python 3.10 or 3.11 with numpy<2, tensorflow-cpu 2.15 and spliceai (pip install spliceai --no-deps, then tensorflow-cpu==2.15.1). SpliceAI is run on windows of
+-window bases around the edits (wide enough to hold all of them) with 5,000 bases of context on each side, averaging its five models. A reference shorter than the
context is padded with N (SpliceAI's own convention at the end of a sequence); the result says so, because scores near an end rest on less context.

Scores are the largest absolute change in acceptor or donor probability (gain or loss) within the window. The app's cut-offs (<= 0.05 supports, <= 0.2 review, above that
advises against) are those of the design review, not SpliceAI's own (0.2 / 0.5 / 0.8). For an allele with unwanted edits the effect judged is the change those edits add to
the intended allele; an indel is scored the way SpliceAI scores one (deleted positions have no score, inserted bases collapse to their maximum). These are predictions, not measurements.
"""
import argparse
import hashlib
import json
import re
import sys

COMP = {"A": "T", "C": "G", "G": "C", "T": "A", "N": "N"}
FLANK = 5000
SCHEMA_REQUEST = "assured-clone-splice-request/1"
SCHEMA_RESULT = "assured-clone-splice-result/1"
UNWANTED_ROLES = ("unplanned", "indel")


def rc(sequence):
    return "".join(COMP.get(b, "N") for b in reversed(sequence))


def digest(payload):
    """SHA-256 of the request without its requestId, in the canonical form the app uses (sorted keys, no spaces)."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def read_genbank_sequence(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        raw = handle.read()
    if "\nORIGIN" not in raw:
        raise ValueError("No ORIGIN section in the GenBank file.")
    body = raw[raw.rindex("\nORIGIN"):].split("\n//")[0].split("\n")[1:]
    seq = "".join(re.sub(r"[^A-Za-z]", "", m.group(1)) for line in body for m in [re.match(r"\s*\d+\s+(.*)$", line)] if m)
    return seq.upper()


def validate_request(request, sequence=None):
    """Raise ValueError for a request that is not exactly what the app exports, or that does not belong to this reference."""
    if request.get("schema") != SCHEMA_REQUEST:
        raise ValueError(f"This is not a clone splice request from the app (schema {SCHEMA_REQUEST}).")
    if request.get("requestId") != digest({k: v for k, v in request.items() if k != "requestId"}):
        raise ValueError("Request SHA-256 does not match its content. Export it again from the app.")
    ref = request.get("reference") or {}
    if type(ref.get("length")) is not int or not re.fullmatch(r"[a-f0-9]{64}", ref.get("sha256", "")):
        raise ValueError("The request does not identify its reference record.")
    if request.get("geneStrand") not in (1, -1):
        raise ValueError("The request has no gene strand.")
    window = request.get("window")
    if type(window) is not int or not 50 <= window <= 5000:
        raise ValueError("Unsupported window.")
    alleles = request.get("alleles")
    if not isinstance(alleles, list) or not 1 <= len(alleles) <= 24:
        raise ValueError("Supply 1-24 alleles.")
    intended = {d.get("id"): d for d in request.get("intended", [])}
    seen = set()
    for item in list(intended.values()) + alleles:
        edits = item.get("edits")
        if not isinstance(edits, list) or not 1 <= len(edits) <= 12:
            raise ValueError("An allele must have 1-12 edits.")
        last = -1
        for e in edits:
            s, t = e.get("start"), e.get("end")
            if type(s) is not int or type(t) is not int or not 0 <= s <= t <= ref["length"] or s < last or (s == t and not e.get("inserted")):
                raise ValueError("Edits must be sorted, non-overlapping and inside the reference.")
            if not re.fullmatch("[ACGTN]*", e.get("ref", "") or "") or not re.fullmatch("[ACGT]*", e.get("inserted", "") or "") or len(e.get("ref", "")) != t - s:
                raise ValueError("Invalid edit sequence.")
            if e.get("role") not in ("intended", "blocking", "unplanned", "indel"):
                raise ValueError("Invalid edit role.")
            if e["inserted"] == e["ref"]:
                raise ValueError("An edit must change the sequence.")
            last = t
    for a in alleles:
        if not re.fullmatch(r"A\d+", a.get("id", "")) or a["id"] in seen:
            raise ValueError("Allele identifiers must be unique.")
        seen.add(a["id"])
        if a.get("intendedId") is not None and a["intendedId"] not in intended:
            raise ValueError("An allele refers to an intended allele that is not in the request.")
    if sequence is not None:
        if len(sequence) != ref["length"] or hashlib.sha256(sequence.encode()).hexdigest() != ref["sha256"]:
            raise ValueError("The reference record is not the one the request was made for. Use the GenBank file that was uploaded to or fetched by the app.")
        for item in list(intended.values()) + alleles:
            for e in item["edits"]:
                if sequence[e["start"]:e["end"]] != e["ref"]:
                    raise ValueError(f"The reference does not have {e['ref']!r} at {e['start'] + 1}.")
    return request


def apply_edits(sequence, edits, origin=0):
    """The sequence with the edits (start, end, inserted; indices on the same scale as `origin`) applied from the right."""
    out = sequence
    for e in sorted(edits, key=lambda e: e["start"], reverse=True):
        out = out[:e["start"] - origin] + e["inserted"] + out[e["end"] - origin:]
    return out


def padded(sequence, lo, hi):
    """sequence[lo:hi], with N where the interval reaches past the ends (and the number of bases that are padding)."""
    left, right = max(0, -lo), max(0, hi - len(sequence))
    return "N" * left + sequence[max(0, lo):min(len(sequence), hi)] + "N" * right, left + right


def align_to_reference(alt, edits, origin, core_length):
    """Alt probabilities (rows = bases of the edited core) on the reference's positions, the way SpliceAI pads an indel: deleted bases have no row (they score zero) and
    inserted bases collapse, with the base that follows them, to their maximum at that base's position. A substitution is base for base."""
    import numpy as np
    out = np.zeros((core_length, alt.shape[1]))
    a = r = 0
    for e in sorted(edits, key=lambda e: e["start"]):
        s, t = e["start"] - origin, e["end"] - origin
        keep = s - r
        out[r:s] = alt[a:a + keep]; a += keep; r = s
        n = len(e["inserted"])
        if n == t - s:                      # substitution: base for base
            out[s:t] = alt[a:a + n]; a += n; r = t
        elif t > s:                         # a replacement of another length: the replaced bases score zero, the new ones collapse onto the first
            if n:
                out[s] = alt[a:a + n].max(axis=0)
            a += n; r = t
        else:                               # a pure insertion: inserted bases and the next base share one position
            out[s] = alt[a:a + n + 1].max(axis=0)
            a += n + 1; r = s + 1
    out[r:] = alt[a:a + (core_length - r)]
    return out


def delta(before, after):
    d = after - before
    out = {"acceptorGain": round(float(d[:, 1].max()), 3), "acceptorLoss": round(float(-d[:, 1].min()), 3),
           "donorGain": round(float(d[:, 2].max()), 3), "donorLoss": round(float(-d[:, 2].min()), 3)}
    out["max"] = max(out.values())
    return out


def score_request(request, sequence, predict, flank=FLANK):
    """Score every allele. `predict(window)` takes a string of core + 2*flank bases and returns the (core, 3) probabilities (neither, acceptor, donor) of its core, in the string's orientation."""
    intended = {d["id"]: d["edits"] for d in request.get("intended", [])}
    every = [e for edits in intended.values() for e in edits] + [e for a in request["alleles"] for e in a["edits"]]
    lo_edit, hi_edit = min(e["start"] for e in every), max(e["end"] for e in every)
    centre = (lo_edit + hi_edit) // 2
    half = max(request["window"], (hi_edit - lo_edit) // 2 + 50)
    core_start, core_end = centre - half, centre + half + 1
    length = core_end - core_start
    window, pad = padded(sequence, core_start - flank, core_end + flank)
    strand = request["geneStrand"]
    cache = {}

    def probabilities(edits):
        key = json.dumps([[e["start"], e["end"], e["inserted"]] for e in edits])
        if key not in cache:
            seq = apply_edits(window, edits, origin=core_start - flank)
            if strand == -1:
                alt = predict(rc(seq))[::-1]
            else:
                alt = predict(seq)
            cache[key] = align_to_reference(alt, [{"start": e["start"], "end": e["end"], "inserted": e["inserted"]} for e in edits], core_start, length) if edits else alt
        return cache[key]

    wild = probabilities([])
    scores, rows = [], {}
    for a in request["alleles"]:
        allele = probabilities(a["edits"])
        unwanted = [e for e in a["edits"] if e["role"] in UNWANTED_ROLES]
        entry = {"allele": a["id"]}
        scores.append({**entry, "comparison": "allele vs wild type", **delta(wild, allele)})
        row = {"editEffectMax": scores[-1]["max"], "unwantedEffectMax": None, "unwantedOnlyMax": None}
        if unwanted:
            only = probabilities(unwanted)
            scores.append({**entry, "comparison": "unwanted edits only vs wild type", **delta(wild, only)})
            row["unwantedOnlyMax"] = scores[-1]["max"]
            if a.get("intendedId") is not None:
                scores.append({**entry, "comparison": "allele vs intended allele", **delta(probabilities(intended[a["intendedId"]]), allele)})
                row["unwantedEffectMax"] = scores[-1]["max"]
            else:
                row["unwantedEffectMax"] = row["editEffectMax"]
        rows[a["id"]] = row
    return {"scores": scores, "summary": {"alleles": rows}, "window": half, "contextPaddedBases": pad, "coreStart": core_start, "coreEnd": core_end}


def load_predictor():
    try:
        import numpy as np
        from pkg_resources import resource_filename
        from keras.models import load_model
        from spliceai.utils import one_hot_encode
    except ImportError as error:
        raise SystemExit(f"Missing package ({error}). See the notes at the top of this file for what to install.")
    models = [load_model(resource_filename("spliceai", f"models/spliceai{i}.h5"), compile=False) for i in range(1, 6)]

    def predict(window):
        encoded = one_hot_encode(window)[None, :]
        return np.mean([m.predict(encoded, verbose=0) for m in models], axis=0)[0]
    return predict


def build_result(request, scored, version):
    note = "Predictions from SpliceAI; the largest absolute change in acceptor or donor probability within the window."
    if scored["contextPaddedBases"]:
        note += f" The reference is shorter than the 5,000-base context on one or both sides: {scored['contextPaddedBases']} bases were padded with N, so these scores rest on less context than SpliceAI was trained with."
    return {"schema": SCHEMA_RESULT, "tool": "SpliceAI", "version": version, "requestId": request["requestId"], "window": scored["window"], "geneStrand": request["geneStrand"],
            "contextPaddedBases": scored["contextPaddedBases"], "scores": scored["scores"], "summary": scored["summary"], "note": note}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("request"); parser.add_argument("reference")
    parser.add_argument("-o", "--out", default="clone_splice_result.json")
    parser.add_argument("--validate-only", action="store_true", help="Check the request against the reference; do not load SpliceAI")
    args = parser.parse_args(argv)
    try:
        request = json.load(open(args.request))
        validate_request(request, read_genbank_sequence(args.reference))
    except (ValueError, OSError, json.JSONDecodeError) as error:
        sys.exit(f"Request refused: {error}")
    if args.validate_only:
        print(json.dumps({"status": "validated-offline", "requestId": request["requestId"], "alleles": len(request["alleles"]), "predictionPerformed": False}))
        return
    import os
    if os.path.exists(args.out):
        sys.exit("Output already exists; choose a new path to preserve earlier results.")
    sequence = read_genbank_sequence(args.reference)
    from importlib.metadata import version as pkg_version
    scored = score_request(request, sequence, load_predictor())
    result = build_result(request, scored, pkg_version("spliceai"))
    json.dump(result, open(args.out, "w"), indent=1, allow_nan=False)
    worst = max((row["unwantedEffectMax"] if row["unwantedEffectMax"] is not None else row["editEffectMax"]) for row in result["summary"]["alleles"].values())
    print(f"{len(request['alleles'])} alleles scored; largest effect {worst:.3f}. Written to {args.out}")


if __name__ == "__main__":
    main()
