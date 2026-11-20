#!/usr/bin/env python3
"""Iteration 06-1: certify observed binary64 fields and exact source sets."""

import argparse
from collections import Counter
from fractions import Fraction as Q
from hashlib import sha256
from itertools import combinations
import json
import math
from pathlib import Path
import sys

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures/v1"
sys.path.insert(0, str(FIXTURES / "tools"))

import independent_check as v1
from observations import DIRECTIONS, load_candidate, observe
from rounding import INFINITY, OVERFLOW_MIDPOINT, Value, ZERO, certify


def select(entries, largest, compare=Value.compare):
    """Return the extremum and every exact winner, preserving source order."""
    iterator = iter(entries)
    label, best = next(iterator)
    winners = [label]
    for label, value in iterator:
        comparison = compare(value, best)
        if comparison == 0:
            winners.append(label)
        elif comparison == (1 if largest else -1):
            best, winners = value, [label]
    return best, winners


def position_reference(source, factor, compare=Value.compare):
    series = {}
    for direction in DIRECTIONS:
        decimals = [v1.parse_decimal(item["value"]) * factor for item in source[direction]]
        values = []
        for decimal in decimals:
            actual = float(decimal)
            if not math.isfinite(actual) or certify(Value(decimal), actual, compare=compare)["status"] != "certified":
                raise ArithmeticError("Input conversion outside the certified positive corpus")
            values.append(Q.from_float(actual))
        series[direction] = values
    return exact_position(series, compare)


def exact_position(series, compare=Value.compare):
    """Evaluate the same mathematical fields on five exact d, b or error values."""
    fields = {}
    for direction in DIRECTIONS:
        values = series[direction]
        if len(values) != 5:
            raise ValueError("Expected five observations per direction")
        mean = sum(values) / 5
        variance = sum((x - mean)**2 for x in values) / 4
        if variance != sum((x - y)**2 for x, y in combinations(values, 2)) / 20:
            raise ArithmeticError("The two exact definitions of sample variance disagree")
        sd = Value(terms=((1, variance),))
        band = sd.scaled(2)
        directional = {"mean": Value(mean), "variance": Value(variance), "sd": sd,
                       "twoSd": band, "range": Value(max(values) - min(values)),
                       "lower": Value(mean) - band, "upper": Value(mean) + band,
                       "R_i": band.scaled(2)}
        fields.update({f"{key}_{direction}": value for key, value in directional.items()})
    fields["mean_both"] = (fields["mean_up"] + fields["mean_down"]).scaled(Q(1, 2))
    fields["B_i"] = fields["mean_up"] - fields["mean_down"]
    fields["C_i"] = Value(abs(fields["B_i"].rational)) + fields["twoSd_up"] + fields["twoSd_down"]
    candidates = [(key, fields[key]) for key in ("C_i", "R_i_up", "R_i_down")]
    strongest, branches = select(candidates, True, compare)
    upper, _ = select(((d, fields["upper_" + d]) for d in DIRECTIONS), True, compare)
    lower, _ = select(((d, fields["lower_" + d]) for d in DIRECTIONS), False, compare)
    fields["R_i"] = upper - lower
    if compare(fields["R_i"], strongest) != 0:
        raise ArithmeticError("Covering interval and maximum branch disagree")
    return fields, branches


def axis_reference(positions, compare=Value.compare):
    sources, axis = {}, {}

    def pick(name, column, directions, largest, absolute=False):
        entries = []
        for pid, fields in positions.items():
            for direction in directions:
                key = column if direction == "both" else column + "_" + direction
                value = fields[key]
                if absolute:
                    value = Value(abs(value.rational))
                entries.append(({"position_id": pid, "direction": direction}, value))
        best, sources[name] = select(entries, largest, compare)
        return best

    for suffix, directions in (("", DIRECTIONS), ("_up", ("up",)), ("_down", ("down",))):
        low = pick("lower_min" + suffix, "lower", directions, False)
        high = pick("upper_max" + suffix, "upper", directions, True)
        axis["A" + suffix] = high - low
        minimum = pick("mean_min" + suffix, "mean", directions, False)
        maximum = pick("mean_max" + suffix, "mean", directions, True)
        axis["E" + suffix] = maximum - minimum
        axis["R" + suffix] = pick("R" + suffix + "_max", "R_i", directions if suffix else ("both",), True)
    axis["M"] = (pick("mean_both_max", "mean_both", ("both",), True)
                 - pick("mean_both_min", "mean_both", ("both",), False))
    axis["B"] = pick("B_abs_max", "B_i", ("both",), True, absolute=True)
    axis["Bbar"] = Value(sum(fields["B_i"].rational for fields in positions.values()) / len(positions))
    return axis, sources


def source_evidence(expected, actual):
    return {"expected": expected, "actual": actual, "passed": expected == actual}


def verify_case(case, candidate):
    audit = v1.Audit()
    v1.assert_positive_structure(case, audit)
    if audit.errors:
        raise ValueError(audit.errors)
    factor = {"um": 1, "mm": 1000}[case["units"]["deviation"]]
    positions, branches, coordinates = {}, {}, {}
    for source in case["positions"]:
        pid = source["position_id"]
        positions[pid], branches[pid] = position_reference(source, factor)
        target = v1.parse_decimal(source["target_mm"])
        coordinates[pid] = certify(Value(target), float(source["target_mm"]))
    axis, sources = axis_reference(positions)
    actual_positions, actual_axis, actual_branches, actual_sources = observe(case, candidate)
    if list(actual_positions) != list(positions):
        raise ValueError("Position IDs or their order differ")
    position_fields = set(v1.POSITION_FIELDS) | {"twoSd_up", "twoSd_down", "range_up", "range_down"}

    def certify_row(name, expected, actual, required):
        if set(expected) != required or set(actual) != required:
            raise ValueError(f"{name}: missing or unexpected field")
        return {key: certify(value, actual[key]) for key, value in expected.items()}

    records = {pid: certify_row(pid, row, actual_positions[pid], position_fields)
               for pid, row in positions.items()}
    records["axis"] = certify_row("axis", axis, actual_axis, set(v1.AXIS_FIELDS))
    if set(sources) != set(v1.EXTREMA_FIELDS):
        raise ValueError("Incomplete reference source inventory")

    def compare_sources(expected, actual):
        if set(actual) != set(expected):
            raise ValueError("Incomplete observed source inventory")
        return {key: source_evidence(value, actual[key]) for key, value in expected.items()}

    # Decimal fixture metadata is consulted for this diagnostic only, after both
    # the independent b reference and all observations have been constructed.
    decimal_branches = {p["position_id"]: p["active_R_branches"] for p in case["expected"]["positions"]}
    differences = {"branches": [pid for pid, value in branches.items() if value != decimal_branches[pid]],
                   "extrema": [key for key, value in sources.items() if value != case["expected"]["extrema"][key]]}
    report = {"fields": records, "coordinates_mm": coordinates, "decimal_source_changes": differences,
              "branches": compare_sources(branches, actual_branches), "extrema": compare_sources(sources, actual_sources)}
    return report, (positions, axis, branches, sources, actual_positions, actual_axis)


def t06_anchors(case, positions, axis):
    nonzero = [(p["position_id"], d, x["repeat"], Q(x["value"]))
               for p in case["positions"] for d in DIRECTIONS for x in p[d] if Q(x["value"])]
    if len(nonzero) != 1 or (nonzero[0][0], nonzero[0][1], nonzero[0][3]) != ("p03", "up", 20):
        return False
    row = positions["p03"]
    root_five = Value(terms=((1, Q(5)),))
    pairs = [(row["mean_up"], Value(4)), (row["variance_up"], Value(80)),
             (row["sd_up"], root_five.scaled(4)), (axis["R"], root_five.scaled(16)),
             (axis["B"], Value(4)), (axis["Bbar"], Value(Q(4, 5)))]
    return all(a.compare(b) == 0 for a, b in pairs)


def mutations(cid, reference):
    pos, axis, branches, sources, actual, totals = reference
    outcomes = {}

    def reject(name, expression, bad_value):
        outcomes[name] = certify(expression, bad_value)["status"] == "mismatch"

    if cid == "P02-mixed-scale":
        reject("false-zero-s", pos["p02"]["sd_up"], 0.0)
    if cid == "T06-single-outlier":
        reject("last-bit", axis["R"], math.nextafter(totals["R"], INFINITY))
        reject("variance-from-rounded-s", pos["p03"]["variance_up"], actual["p03"]["sd_up"]**2)
        outcomes["wrong-R-branch"] = not source_evidence(branches["p03"], ["C_i"])["passed"]
    if cid == "M01-swap-directions":
        neighbor = math.nextafter(actual["p00011"]["B_i"], INFINITY)
        reject("wrong-side-of-fixture-halfway", pos["p00011"]["B_i"], neighbor)
    if cid == "T04-negative-reversal":
        reject("wrong-Bbar-sign", axis["Bbar"], -totals["Bbar"])
    if cid == "T01-zero":
        reject("negative-exact-zero", axis["Bbar"], -0.0)
        # Dropping one true source changes no numerical maximum.
        outcomes["lost-tied-extremum"] = not source_evidence(sources["upper_max"], sources["upper_max"][1:])["passed"]
    return outcomes


def boundary_checks():
    one = Q(1)
    half_ulp = Q(1, 2**53)
    half_sub = Q(1, 2**1075)
    min_normal = sys.float_info.min
    max_finite = sys.float_info.max
    even_above = math.nextafter(math.nextafter(1., INFINITY), INFINITY)
    # Although the expression contains irrational roots, their sum here is exactly zero.
    cancelled = Value(one + half_ulp, ((2, Q(5)), (-1, Q(20))))
    # sqrt(2)/2**200 lies on either side of an exact halfway when added/subtracted.
    tiny_root = Value(terms=((Q(1, 2**200), Q(2)),))
    halfway = Value(one + half_ulp)
    cases = {
        "zero": (ZERO, 0.0),
        "negative-zero-underflow-tie": (Value(-half_sub), -0.0),
        "positive-zero-underflow-tie": (Value(half_sub), 0.0),
        "least-subnormal": (Value(2 * half_sub), math.ulp(0.0)),
        "lower-neighbor-of-power-tie": (Value(one - half_ulp / 2), 1.0),
        "even-lower-tie": (halfway, 1.0),
        "even-upper-tie": (Value(one + 3 * half_ulp), even_above),
        "negative-normal-tie": (Value(-one - half_ulp), -1.0),
        "radicals-cancel-at-tie": (cancelled, 1.0),
        "radical-below-midpoint": (halfway - tiny_root, 1.0),
        "radical-above-midpoint": (halfway + tiny_root, math.nextafter(1.0, INFINITY)),
        "normal-subnormal-tie": (Value(Q(min_normal) - half_sub), min_normal),
        "largest-subnormal": (Value(Q(min_normal) - 2 * half_sub), math.nextafter(min_normal, 0.)),
        "finite-before-overflow": (Value(OVERFLOW_MIDPOINT - 1), max_finite),
        "positive-overflow-tie": (Value(OVERFLOW_MIDPOINT), INFINITY),
        "negative-overflow-tie": (Value(-OVERFLOW_MIDPOINT), -INFINITY),
    }
    accepted = {key: certify(value, x) for key, (value, x) in cases.items()}
    rejected = {"wrong-halfway": (cancelled, math.nextafter(1., INFINITY)),
                "wrong-subnormal-sign": (Value(-half_sub), 0.0),
                "premature-infinity": (Value(OVERFLOW_MIDPOINT - 1), INFINITY),
                "finite-at-overflow-tie": (Value(OVERFLOW_MIDPOINT), max_finite)}
    return accepted, {name: certify(value, bad)["status"] == "mismatch" for name, (value, bad) in rejected.items()}


def run(candidate):
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    cases, errors, rejected = {}, {}, {}
    summary = Counter()
    for entry in manifest["cases"]:
        cid = entry["case_id"]
        data = (FIXTURES / entry["path"]).read_bytes()
        if sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"SHA-256 mismatch: {cid}")
        if entry["category"] == "invalid":
            continue
        case = json.loads(data)
        if case["case_id"] != cid or cid in cases:
            raise ValueError(f"Unexpected case ID: {cid}")
        try:
            report, context = verify_case(case, candidate)
        except (ArithmeticError, ValueError, AssertionError) as error:
            errors[cid] = f"{type(error).__name__}: {error}"
            continue
        cases[cid] = report
        count = len(case["positions"])
        summary["positions"] += count
        summary["series_variances_cross_checked"] += count * 2
        for key, row in report["fields"].items():
            summary["axis_fields" if key == "axis" else "position_fields"] += len(row)
            for proof in row.values():
                summary[proof["status"]] += 1
                summary["exact_zero"] += proof.get("exact_sign") == 0
                summary["halfway"] += 0 in (proof.get("left"), proof.get("right"))
        summary["coordinates_certified"] += sum(p["status"] == "certified" for p in report["coordinates_mm"].values())
        for family in ("branches", "extrema"):
            for check in report[family].values():
                summary[family + "_passed"] += check["passed"]
                summary[family + "_multiple_sources"] += len(check["expected"]) > 1
        rejected.update(mutations(cid, context))
        if cid == "T06-single-outlier":
            report["anchors_passed"] = t06_anchors(case, *context[:2])
            if not report["anchors_passed"]:
                errors[cid] = "Analytical T06 controls failed"

    boundary, boundary_mutations = boundary_checks()
    rejected.update(boundary_mutations)
    counts = manifest["counts"]
    n = counts["positive_positions"]
    num_cases = counts["positive_with_all_outputs"]
    expected = {"positions": n, "coordinates_certified": n, "series_variances_cross_checked": 2*n,
                "position_fields": 20*n, "axis_fields": 12*num_cases, "certified": 20*n + 12*num_cases,
                "branches_passed": n, "extrema_passed": len(v1.EXTREMA_FIELDS)*num_cases}
    summary["not_examined"] = expected["certified"] - summary["position_fields"] - summary["axis_fields"]
    for status in ("mismatch", "uncertified"):
        summary.setdefault(status, 0)
    complete = (len(cases) == num_cases and all(summary[key] == num for key, num in expected.items())
                and all(item["status"] == "certified" for item in boundary.values())
                and len(rejected) == 12 and all(rejected.values()) and not errors)
    return {"policy": "vsz-num-0.2 / Proposed", "observed": "PRE-06" if candidate else "03A",
            "passed": complete, "summary": dict(summary), "expected_counts": expected, "errors": errors,
            "cases": cases, "boundary": boundary, "mutations_rejected": rejected}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Create a new detailed JSON log outside the repository")
    parser.add_argument("--candidate", type=Path, help="Optional verified PRE-06 certified_policy_probe.py")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Run without -O, so all v1 and optional candidate checks are active")
    if sys.float_info.radix != 2 or sys.float_info.mant_dig != 53 or sys.float_info.max_exp != 1024:
        parser.error("IEEE binary64 Python floats required")
    if args.output and args.output.resolve().is_relative_to(FIXTURES.parents[2]):
        parser.error("Choose an output path outside the repository")
    report = run(load_candidate(args.candidate) if args.candidate else None)
    if args.output:
        with args.output.open("x", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
            handle.write("\n")
    print(json.dumps({key: report[key] for key in ("observed", "passed", "summary", "errors", "mutations_rejected")}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
