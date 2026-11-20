"""Certify one synthetic axis. Each benchmark runs in a fresh Python process."""

import argparse
from collections import Counter
from fractions import Fraction
from hashlib import sha256
import json
import math
from pathlib import Path
import resource
import sys
from time import perf_counter

from verify_reference import FIXTURES, DIRECTIONS, axis_reference, position_reference, v1
from bounded_comparison import BoundedComparison
from numerical_stress import canonical_input_hash, generator
from observations import observe
from input_loss import budget
from precision_failures import blocked_attempt, valid_block
from rounding import certify


def canonical(record):
    return json.dumps(record, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def from_rows(name, rows):
    positions = []
    for row in rows:
        p = {"position_id": row["id"], "target_mm": row["target_mm"]}
        for d in DIRECTIONS:
            p[d] = [{"repeat": j, "value": raw} for j, raw in enumerate(row[d], 1)]
        positions.append(p)
    return {"case_id": name, "positions": positions, "units": {"deviation": "um"}}


def verify_axis(case, candidate=None):
    """Hash every checked address, rounding witness and winner in a reproducible order."""
    comparison = BoundedComparison()
    actual_rows, actual_axis, branches, extrema = observe(case, candidate)
    exact = {}
    digest = sha256()
    count = Counter()
    position_fields = set(v1.POSITION_FIELDS) | {"range_up", "range_down", "twoSd_up", "twoSd_down"}

    def check_fields(pid, expected, observed, required):
        if set(expected) != required or set(observed) != required:
            raise ValueError(f"{pid}: output inventory differs")
        for key in sorted(required):
            number = observed[key]
            proof = certify(expected[key], number, compare=comparison)
            if proof["status"] != "certified":
                raise ValueError((case["case_id"], pid, key, proof))
            if not math.isfinite(number) or (0 < abs(number) < sys.float_info.min) or (
                    number == 0 and proof["exact_sign"] != 0):
                raise ValueError((pid, key, "outside expected normal/zero domain"))
            count["certified"] += 1
            count["exact_zero"] += number == 0
            count["halfway"] += 0 in (proof["left"], proof["right"])
            digest.update(canonical([pid, key, proof]) + b"\n")

    ids = [row["position_id"] for row in case["positions"]]
    if len(set(ids)) != len(ids) or ids != list(actual_rows) or set(ids) != set(branches):
        raise ValueError("Position inventory differs")
    factor = {"mm": 1000, "um": 1}[case["units"]["deviation"]]
    for p in case["positions"]:
        pid = p["position_id"]
        fields, winners = position_reference(p, factor, comparison)
        check_fields(pid, fields, actual_rows[pid], position_fields)
        if branches[pid] != winners:
            raise ValueError((pid, "branch mismatch"))
        digest.update(canonical([pid, "branches", winners]) + b"\n")
        count["branch_ties"] += len(winners) > 1
        exact[pid] = fields
    axis, sources = axis_reference(exact, comparison)
    if sources != extrema or set(sources) != set(v1.EXTREMA_FIELDS):
        raise ValueError("Extremum sources differ")
    check_fields("axis", axis, actual_axis, set(v1.AXIS_FIELDS))
    digest.update(canonical(sources))
    count["extrema_ties"] = sum(len(s) > 1 for s in sources.values())
    return {"positions": len(ids), "observations": 10*len(ids), "fields": dict(count),
            "sources_checked": len(ids) + len(sources), "precision": comparison.counts(),
            "evidence_sha256": digest.hexdigest()}


def check_p05_gate(rows):
    literals = {raw for p in rows for d in DIRECTIONS for raw in p[d]}
    decimals = {Fraction(raw) for raw in literals}
    if len(set(map(float, decimals))) != len(decimals):
        raise ValueError("Unexpected P05 representation collision")
    snapshot = {"unit": "um", "rows": rows}
    name = f"P05-{len(rows)}"
    reason = budget({"unit": "um"})
    if reason != "budget-not-approved":
        raise ValueError("Unexpected production budget")
    blocked = blocked_attempt(name, snapshot, "budget", reason, {"family": "Bbar"}, {"unit": "um"})
    if not valid_block(blocked, snapshot, reason, source_id=name):
        raise ValueError("Invalid P05 blocked-attempt envelope")
    return {"reason": reason, "expected_blocks": 1, "collisions": 0, "input_digest": blocked["inputDigest"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--positions", type=int, choices=(5, 12, 1000, 10000), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(FIXTURES.parents[2]):
        parser.error("Output must be outside the repository")
    start = perf_counter()
    rows = generator(args.positions)
    result = verify_axis(from_rows("P05", rows))
    result["input_sha256"] = canonical_input_hash(rows)
    result["first_layer"] = check_p05_gate(rows)
    result["wall_seconds"] = round(perf_counter() - start, 6)
    result["peak_rss_kib"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss if sys.platform == "linux" else None
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(result, out, sort_keys=True, indent=2)
        out.write("\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
