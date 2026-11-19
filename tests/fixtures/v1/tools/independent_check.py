#!/usr/bin/env python3
"""Independent verification of VSZ v1 synthetic fixtures.

This module deliberately imports neither the fixture generator nor its oracle.
Numerical route: mpmath, 120 decimal working digits, pairwise sample variance,
and the width of the smallest interval covering both directional intervals.
Exact Fraction predicates are used only for rational certificates, exact zeros,
branch/tie classification and input/transformation checks. No float input is used.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from fractions import Fraction
from functools import cmp_to_key
from itertools import combinations
import json
from math import isqrt
from pathlib import Path
import platform
import re
import sys

import mpmath as mp

WORK_DIGITS = 120
OUTPUT_DIGITS = 70
mp.mp.dps = WORK_DIGITS
AXIS_FIELDS = ("A", "A_up", "A_down", "E", "E_up", "E_down", "M", "R", "R_up", "R_down", "B", "Bbar")
POSITION_FIELDS = (
    "mean_up", "mean_down", "mean_both", "variance_up", "variance_down",
    "sd_up", "sd_down", "lower_up", "upper_up", "lower_down", "upper_down",
    "B_i", "R_i_up", "R_i_down", "C_i", "R_i",
)
FRACTION_FIELDS = ("mean_up", "mean_down", "mean_both", "variance_up", "variance_down", "B_i")
EXTREMA_FIELDS = (
    "mean_min", "mean_min_up", "mean_min_down", "mean_max", "mean_max_up", "mean_max_down",
    "lower_min", "lower_min_up", "lower_min_down", "upper_max", "upper_max_up", "upper_max_down",
    "mean_both_min", "mean_both_max", "R_max", "R_up_max", "R_down_max", "B_abs_max",
)
NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
PROFILE = "gost-27843-2006-linear-axis-le-2000-v1"


def qmp(q: Fraction) -> mp.mpf:
    return mp.mpf(q.numerator) / q.denominator


def sign(q):
    return (q > 0) - (q < 0)


def parse_decimal(value: str) -> Fraction:
    if not isinstance(value, str) or NUMBER.fullmatch(value) is None:
        raise ValueError("Expected a finite decimal string")
    return Fraction(value)


def compare_q_to_root_difference(q: Fraction, high: Fraction, low: Fraction) -> int:
    """Exact sign of q - (sqrt(high)-sqrt(low)); q>=0 and high>=low>=0."""
    assert q >= 0 and high >= low >= 0
    if q == 0:
        return 0 if high == low else -1
    left = high - low - q * q
    if left < 0:
        return 1
    if left == 0:
        return 0 if low == 0 else 1
    return -sign(left * left - 4 * q * q * low)


def exact_branches(b: Fraction, vu: Fraction, vd: Fraction) -> list[str]:
    relation = compare_q_to_root_difference(abs(b) / 2, max(vu, vd), min(vu, vd))
    unilateral = ["R_i_up"] if vu > vd else ["R_i_down"] if vd > vu else ["R_i_up", "R_i_down"]
    if relation > 0:
        return ["C_i"]
    if relation == 0:
        return ["C_i", *unilateral]
    return unilateral


def compare_bands(a, b, band_sign: int) -> int:
    """Exact ordering of rational_mean + band_sign*2*sqrt(rational_variance)."""
    ma, va = a
    mb, vb = b
    d = ma - mb
    root_sign = band_sign * sign(va - vb)
    if root_sign == 0:
        return sign(d)
    if d == 0:
        return root_sign
    if sign(d) == root_sign:
        return sign(d)
    relation = compare_q_to_root_difference(abs(d) / 2, max(va, vb), min(va, vb))
    return sign(d) * relation


def normalize_radicals(constant, terms):
    """Combine square-root terms by exact rational-square equivalence.

    This avoids integer factorization. Distinct remaining square classes are
    linearly independent over the rationals, so equality is decided exactly.
    """
    combined = []
    for coefficient, radicand in terms:
        if coefficient == 0 or radicand == 0:
            continue
        rn, rd = isqrt(radicand.numerator), isqrt(radicand.denominator)
        if rn * rn == radicand.numerator and rd * rd == radicand.denominator:
            constant += coefficient * Fraction(rn, rd)
            continue
        for index, (old_coefficient, old_radicand) in enumerate(combined):
            ratio = radicand / old_radicand
            rn, rd = isqrt(ratio.numerator), isqrt(ratio.denominator)
            if rn * rn == ratio.numerator and rd * rd == ratio.denominator:
                combined[index] = (old_coefficient + coefficient * Fraction(rn, rd), old_radicand)
                break
        else:
            combined.append((coefficient, radicand))
    return constant, [(coefficient, radicand) for coefficient, radicand in combined if coefficient]


def compare_radical_expressions(a, b):
    """Exact interval proof of the sign of two short rational radical sums."""
    constant, terms = normalize_radicals(a[0] - b[0], a[1] + [(-coefficient, radicand) for coefficient, radicand in b[1]])
    if not terms:
        return sign(constant)
    for digits in (40, 80, 160, 320, 640, 1280, 2560):
        scale = 10 ** digits
        lower = upper = constant
        for coefficient, radicand in terms:
            floor_root = isqrt(radicand.numerator * scale * scale // radicand.denominator)
            lo, hi = Fraction(floor_root, scale), Fraction(floor_root + 1, scale)
            if coefficient > 0:
                lower += coefficient * lo
                upper += coefficient * hi
            else:
                lower += coefficient * hi
                upper += coefficient * lo
        if lower > 0:
            return 1
        if upper < 0:
            return -1
    raise ArithmeticError("Unable to certify radical ordering within 2560 decimal interval digits")


def exact_R_expression(row):
    e = row["exact"]
    # Any active branch is exact; prefer a unilateral branch when present.
    if "R_i_up" in row["active_R_branches"]:
        return Fraction(0), [(Fraction(4), e["variance_up"])]
    if "R_i_down" in row["active_R_branches"]:
        return Fraction(0), [(Fraction(4), e["variance_down"])]
    return abs(e["B_i"]), [(Fraction(2), e["variance_up"]), (Fraction(2), e["variance_down"])]


def numerical_close(a, b, digits=105):
    return abs(a - b) <= mp.mpf(10) ** (-digits) * max(abs(a), abs(b), mp.mpf(1))


def rounded_decimal(value) -> Decimal:
    # 110 printed digits leave a 40-digit guard over the fixture precision.
    with localcontext() as context:
        context.prec = OUTPUT_DIGITS
        context.rounding = ROUND_HALF_EVEN
        return +Decimal(mp.nstr(value, 110))


class Audit:
    def __init__(self):
        self.errors = []
        self.counts = Counter()
        self.case_results = []
        self.transformations = []
        self.branch_counts = Counter()
        self.mutation_results = []
        self.checker_self_tests = []
        self.max_relative_serialization_error = mp.mpf(0)

    def require(self, condition, location, detail, kind="structural_checks"):
        self.counts[kind] += 1
        if not condition:
            self.errors.append({"location": location, "detail": detail})

    def compare(self, actual, reference, location):
        self.counts["serialized_numeric_values"] += 1
        if not isinstance(actual, str) or NUMBER.fullmatch(actual) is None:
            self.errors.append({"location": location, "detail": "Expected result must be a finite decimal string"})
            return
        actual_decimal = Decimal(actual)
        canonical = rounded_decimal(reference)
        if actual_decimal != canonical:
            self.errors.append({"location": location, "detail": "Serialized value differs from independent 70-significant-digit rounding", "serialized": actual, "independent_rounded": str(canonical)})
        if reference == 0:
            self.require(actual_decimal == 0, location, "Mathematical zero must remain exactly zero", "exact_zero_checks")
        else:
            relative = abs(mp.mpf(actual) - reference) / abs(reference)
            self.max_relative_serialization_error = max(self.max_relative_serialization_error, relative)


def series_statistics(values: list[str], factor: Fraction, audit: Audit, location: str):
    fractions = [parse_decimal(x) * factor for x in values]
    numeric = [mp.mpf(x) * qmp(factor) for x in values]
    raw_mean = mp.fsum(numeric) / 5
    exact_mean = sum(fractions, Fraction(0)) / 5
    exact_variance = sum(((a - b) ** 2 for a, b in combinations(fractions, 2)), Fraction(0)) / 20
    variance = mp.fsum((a - b) ** 2 for a, b in combinations(numeric, 2)) / 20
    audit.require(numerical_close(raw_mean, qmp(exact_mean)), location, "Independent mpmath sum disagrees with exact rational mean", "cross_arithmetic_checks")
    audit.require(numerical_close(variance, qmp(exact_variance)), location, "Pairwise mpmath variance disagrees with exact pairwise rational variance", "cross_arithmetic_checks")
    # Canonical rational means avoid false inequality of mathematically identical
    # means that arrived through different mpmath summation orders.
    mean = qmp(exact_mean)
    sd = mp.sqrt(variance)
    return {"mean": mean, "variance": variance, "sd": sd, "lower": mean - 2 * sd, "upper": mean + 2 * sd,
            "repeatability": 4 * sd, "exact_mean": exact_mean, "exact_variance": exact_variance,
            "fractions": fractions, "numeric": numeric}


def extrema(records, kind, direction, band_sign=None):
    # Input order is position-major, up then down. Ties preserve that order.
    if band_sign is None:
        best = min(x["exact_mean"] for x in records) if direction == "min" else max(x["exact_mean"] for x in records)
        chosen = [x for x in records if x["exact_mean"] == best]
    else:
        comparator = lambda a, b: compare_bands((a["exact_mean"], a["exact_variance"]), (b["exact_mean"], b["exact_variance"]), band_sign)
        sorted_records = sorted(records, key=cmp_to_key(comparator))
        best = sorted_records[0] if direction == "min" else sorted_records[-1]
        chosen = [x for x in records if comparator(x, best) == 0]
    return [{"position_id": x["position_id"], "direction": x["direction"]} for x in chosen]


def calculate(case, audit: Audit):
    identifier = case["case_id"]
    factor = Fraction(1) if case["units"]["deviation"] == "um" else Fraction(1000)
    rows, all_directional = [], []
    for source in case["positions"]:
        pid = source["position_id"]
        s = {}
        for direction in ("up", "down"):
            values = [item["value"] for item in source[direction]]
            s[direction] = series_statistics(values, factor, audit, identifier + "/" + pid + "/" + direction)
            all_directional.append({"position_id": pid, "direction": direction, **s[direction]})
        u, d = s["up"], s["down"]
        reversal = u["exact_mean"] - d["exact_mean"]
        both = (u["exact_mean"] + d["exact_mean"]) / 2
        row = {"position_id": pid, "mean_up": u["mean"], "mean_down": d["mean"], "mean_both": qmp(both),
               "variance_up": u["variance"], "variance_down": d["variance"], "sd_up": u["sd"], "sd_down": d["sd"],
               "lower_up": u["lower"], "upper_up": u["upper"], "lower_down": d["lower"], "upper_down": d["upper"],
               "B_i": qmp(reversal), "R_i_up": u["repeatability"], "R_i_down": d["repeatability"],
               "C_i": 2 * (u["sd"] + d["sd"]) + abs(qmp(reversal)),
               "R_i": max(u["upper"], d["upper"]) - min(u["lower"], d["lower"]),
               "active_R_branches": exact_branches(reversal, u["exact_variance"], d["exact_variance"]),
               "exact": {"mean_up": u["exact_mean"], "mean_down": d["exact_mean"], "mean_both": both,
                         "variance_up": u["exact_variance"], "variance_down": d["exact_variance"], "B_i": reversal},
               "series": s}
        rows.append(row)
    means = [x["exact_mean"] for x in all_directional]
    axis = {
        "A": max(x["upper"] for x in all_directional) - min(x["lower"] for x in all_directional),
        "E": qmp(max(means) - min(means)),
        "M": qmp(max(x["exact"]["mean_both"] for x in rows) - min(x["exact"]["mean_both"] for x in rows)),
        "R": max(x["R_i"] for x in rows),
        "B": qmp(max(abs(x["exact"]["B_i"]) for x in rows)),
        "Bbar": qmp(sum((x["exact"]["B_i"] for x in rows), Fraction(0)) / len(rows)),
    }
    for direction in ("up", "down"):
        subset = [x for x in all_directional if x["direction"] == direction]
        axis["A_" + direction] = max(x["upper"] for x in subset) - min(x["lower"] for x in subset)
        axis["E_" + direction] = qmp(max(x["exact_mean"] for x in subset) - min(x["exact_mean"] for x in subset))
        axis["R_" + direction] = max(x["repeatability"] for x in subset)
    ties = {"mean_min": extrema(all_directional, "mean", "min"), "mean_max": extrema(all_directional, "mean", "max"),
            "lower_min": extrema(all_directional, "lower", "min", -1), "upper_max": extrema(all_directional, "upper", "max", 1)}
    for direction in ("up", "down"):
        subset = [x for x in all_directional if x["direction"] == direction]
        ties["mean_min_" + direction] = extrema(subset, "mean", "min")
        ties["mean_max_" + direction] = extrema(subset, "mean", "max")
        ties["lower_min_" + direction] = extrema(subset, "lower", "min", -1)
        ties["upper_max_" + direction] = extrema(subset, "upper", "max", 1)
        greatest_variance = max(p["exact"]["variance_" + direction] for p in rows)
        ties["R_" + direction + "_max"] = [{"position_id": p["position_id"], "direction": direction} for p in rows if p["exact"]["variance_" + direction] == greatest_variance]
    for extremum, operator in (("min", min), ("max", max)):
        target = operator(p["exact"]["mean_both"] for p in rows)
        ties["mean_both_" + extremum] = [{"position_id": p["position_id"], "direction": "both"} for p in rows if p["exact"]["mean_both"] == target]
    target_b = max(abs(p["exact"]["B_i"]) for p in rows)
    ties["B_abs_max"] = [{"position_id": p["position_id"], "direction": "both"} for p in rows if abs(p["exact"]["B_i"]) == target_b]
    r_comparator = lambda a, b: compare_radical_expressions(exact_R_expression(a), exact_R_expression(b))
    target_r = max(rows, key=cmp_to_key(r_comparator))
    ties["R_max"] = [{"position_id": p["position_id"], "direction": "both"} for p in rows if r_comparator(p, target_r) == 0]
    rational_axis = {"E": max(means) - min(means), "M": max(p["exact"]["mean_both"] for p in rows) - min(p["exact"]["mean_both"] for p in rows),
                     "B": target_b, "Bbar": sum((p["exact"]["B_i"] for p in rows), Fraction(0)) / len(rows)}
    for direction in ("up", "down"):
        mu = [p["exact"]["mean_" + direction] for p in rows]
        rational_axis["E_" + direction] = max(mu) - min(mu)
    return {"positions": rows, "axis": {key: axis[key] for key in AXIS_FIELDS}, "extrema": ties, "rational_axis": rational_axis}


def assert_positive_structure(case, audit):
    cid = case["case_id"]
    audit.require(case.get("schema_version") == "vsz-fixtures-1.0", cid, "Unexpected schema version")
    audit.require(case.get("profile_id") == PROFILE, cid, "Unexpected calculation profile")
    audit.require(case.get("sd_method") == "sample-n-minus-1", cid, "Wrong or missing standard-deviation method")
    units = case.get("units", {})
    audit.require(units.get("coordinate") == "mm" and units.get("deviation") in ("um", "mm") and units.get("expected") == "um" and units.get("variance") == "um2", cid, "Unsupported or ambiguous units")
    positions = case.get("positions", [])
    audit.require(len(positions) >= 5, cid, "A positive fixture needs at least five positions")
    ids, targets = [], []
    for p in positions:
        ids.append(p.get("position_id"))
        target = parse_decimal(p["target_mm"])
        targets.append(target)
        audit.require(0 <= target <= Fraction(case["context"]["full_travel_mm"]), cid + "/" + str(p.get("position_id")), "Target outside the synthetic axis travel")
        for direction in ("up", "down"):
            series = p.get(direction, [])
            audit.require(len(series) == 5, cid, "Exactly five observations per direction are required")
            audit.require([x.get("repeat") for x in series] == [1, 2, 3, 4, 5], cid, "Repeat indices must be 1..5 in order")
            for item in series:
                parse_decimal(item["value"])
    audit.require(len(set(ids)) == len(ids), cid, "Duplicate position IDs")
    audit.require(len(set(targets)) == len(targets), cid, "Duplicate target coordinates")


def check_invariants(reference, audit, cid):
    a = reference["axis"]
    slack = mp.mpf("1e-105") * max([abs(v) for v in a.values()] + [mp.mpf(1)])
    for name, others in (("A", ("A_up", "A_down", "E", "R")), ("E", ("E_up", "E_down", "M", "B")), ("R", ("R_up", "R_down", "B"))):
        for other in others:
            audit.require(a[name] + slack >= a[other], cid, name + " >= " + other, "invariant_checks")
    audit.require(a["B"] + slack >= abs(a["Bbar"]), cid, "B >= abs(Bbar)", "invariant_checks")
    for field, value in a.items():
        audit.require(field == "Bbar" or value >= 0, cid, "Nonnegative axis result " + field, "invariant_checks")
    for p in reference["positions"]:
        values = [p[x] for x in ("C_i", "R_i_up", "R_i_down")]
        audit.require(numerical_close(p["R_i"], max(values)), cid + "/" + p["position_id"], "Covering interval width must equal the maximum of three R candidates", "invariant_checks")
        audit.require(p["R_i"] + slack >= abs(p["B_i"]), cid, "R_i >= abs(B_i)", "invariant_checks")
        for direction in ("up", "down"):
            audit.require(p["variance_" + direction] >= 0 and p["sd_" + direction] >= 0, cid, "Nonnegative variance and SD", "invariant_checks")


def check_analytical(reference, audit, cid):
    """Exact-rational roots and the four-equal-plus-one-outlier closed form."""
    for p in reference["positions"]:
        for direction in ("up", "down"):
            s = p["series"][direction]
            variance = s["exact_variance"]
            nr, dr = isqrt(variance.numerator), isqrt(variance.denominator)
            if nr * nr == variance.numerator and dr * dr == variance.denominator:
                audit.require(numerical_close(s["sd"], qmp(Fraction(nr, dr))), cid, "Analytical rational square root", "analytical_checks")
            counts = Counter(s["fractions"])
            if sorted(counts.values()) == [1, 4]:
                repeated = next(x for x, n in counts.items() if n == 4)
                outlier = next(x for x, n in counts.items() if n == 1)
                delta = outlier - repeated
                audit.require(s["exact_mean"] == repeated + delta / 5, cid, "One-outlier analytical mean", "analytical_checks")
                audit.require(variance == delta * delta / 5, cid, "One-outlier analytical variance", "analytical_checks")
                audit.require(numerical_close(s["sd"], abs(qmp(delta)) / mp.sqrt(5)), cid, "One-outlier analytical SD", "analytical_checks")
    us = {x for p in reference["positions"] for x in p["series"]["up"]["fractions"]}
    ds = {x for p in reference["positions"] for x in p["series"]["down"]["fractions"]}
    if len(us) == len(ds) == 1:
        u, d = next(iter(us)), next(iter(ds))
        expected_axis = {key: Fraction(0) for key in AXIS_FIELDS}
        for key in ("A", "E", "R", "B"):
            expected_axis[key] = abs(u - d)
        expected_axis["Bbar"] = u - d
        for key in AXIS_FIELDS:
            audit.require(numerical_close(reference["axis"][key], qmp(expected_axis[key])), cid, "Constant-directions analytical " + key, "analytical_checks")


def check_case(case, audit):
    cid = case["case_id"]
    assert_positive_structure(case, audit)
    reference = calculate(case, audit)
    stored = case["expected"]
    audit.require(set(stored["axis"]) == set(AXIS_FIELDS), cid, "Axis fields must contain exactly all 12 required results")
    audit.require([x["position_id"] for x in stored["positions"]] == [x["position_id"] for x in reference["positions"]], cid, "Expected positions must preserve input identity/order")
    for expected, actual in zip(stored["positions"], reference["positions"]):
        pid = actual["position_id"]
        for field in POSITION_FIELDS:
            audit.compare(expected.get(field), actual[field], cid + "/" + pid + "/" + field)
        audit.require(expected.get("active_R_branches") == actual["active_R_branches"], cid + "/" + pid, "Exact active R branches disagree", "branch_checks")
        audit.branch_counts["+".join(actual["active_R_branches"])] += 1
    for field in AXIS_FIELDS:
        audit.compare(stored["axis"].get(field), reference["axis"][field], cid + "/axis/" + field)
    audit.require(set(stored.get("extrema", {})) == set(reference["extrema"]), cid, "Missing or extra extrema identity fields", "extrema_checks")
    for field in reference["extrema"]:
        audit.require(stored.get("extrema", {}).get(field) == reference["extrema"][field], cid + "/extrema/" + field, "Exact extremum/tie identities or their order disagree", "extrema_checks")
    if "exact" in case:
        rational_rows = case["exact"]["positions"]
        audit.require([x["position_id"] for x in rational_rows] == [x["position_id"] for x in reference["positions"]], cid, "Exact rational certificates have wrong position order")
        for expected, actual in zip(rational_rows, reference["positions"]):
            for field in FRACTION_FIELDS:
                audit.require(isinstance(expected[field], str) and Fraction(expected[field]) == actual["exact"][field], cid + "/exact/" + actual["position_id"] + "/" + field, "Exact rational certificate mismatch", "rational_certificate_checks")
        for field, value in reference["rational_axis"].items():
            expected = case["exact"]["axis_rational"][field]
            audit.require(isinstance(expected, str) and Fraction(expected) == value, cid + "/exact/axis_rational/" + field, "Exact rational axis certificate mismatch", "rational_certificate_checks")
    check_invariants(reference, audit, cid)
    check_analytical(reference, audit, cid)
    audit.case_results.append({"case_id": cid, "positions": len(case["positions"]), "axis_values_checked": 12, "position_numeric_values_checked": 16 * len(case["positions"]), "category": case["category"]})
    return reference


def normalized_observations(case):
    factor = Fraction(1) if case["units"]["deviation"] == "um" else Fraction(1000)
    return {(p["position_id"], direction, x["repeat"]): parse_decimal(x["value"]) * factor
            for p in case["positions"] for direction in ("up", "down") for x in p[direction]}


def check_dependency_metadata(case, old, new, audit):
    """Check M06 explanatory lists against independently computed results."""
    cid = case["case_id"]
    parameters = case["transformation"]["parameters"]
    metadata = case.get("dependency_check")
    audit.require(isinstance(metadata, dict), cid + "/dependency_check", "M06 dependency metadata is required", "dependency_metadata_checks")
    if not isinstance(metadata, dict):
        return
    old_rows = {p["position_id"]: p for p in old["positions"]}
    new_rows = {p["position_id"]: p for p in new["positions"]}
    target_id = parameters["position_id"]
    previous, current = old_rows[target_id], new_rows[target_id]
    changed_position = [field for field in POSITION_FIELDS if rounded_decimal(previous[field]) != rounded_decimal(current[field])]
    changed_axis = [field for field in AXIS_FIELDS if rounded_decimal(old["axis"][field]) != rounded_decimal(new["axis"][field])]
    changed_extrema = [field for field in EXTREMA_FIELDS if old["extrema"][field] != new["extrema"][field]]
    other_positions_unchanged = all(
        all(rounded_decimal(previous[field]) == rounded_decimal(new_rows[pid][field]) for field in POSITION_FIELDS)
        and previous["exact"] == new_rows[pid]["exact"]
        and previous["active_R_branches"] == new_rows[pid]["active_R_branches"]
        for pid, previous in old_rows.items() if pid != target_id
    )
    audit.require(metadata.get("changed_position_fields") == changed_position, cid + "/dependency_check/changed_position_fields", "Changed position field list differs from independent rounded results", "dependency_metadata_checks")
    audit.require(metadata.get("changed_axis_fields") == changed_axis, cid + "/dependency_check/changed_axis_fields", "Changed axis field list differs from independent rounded results", "dependency_metadata_checks")
    audit.require(metadata.get("changed_extrema_fields") == changed_extrema, cid + "/dependency_check/changed_extrema_fields", "Changed extrema list differs from exact independent identities", "dependency_metadata_checks")
    audit.require(metadata.get("unchanged_other_positions") is other_positions_unchanged and other_positions_unchanged,
                  cid + "/dependency_check/unchanged_other_positions", "Other positions must actually remain unchanged", "dependency_metadata_checks")
    mean_field = "mean_" + parameters["direction"]
    actual_delta = current["exact"][mean_field] - previous["exact"][mean_field]
    stored_delta = metadata.get("expected_mean_delta_um")
    correct_delta = (isinstance(stored_delta, str) and NUMBER.fullmatch(stored_delta) is not None
                     and Fraction(stored_delta) == actual_delta == Fraction(parameters["delta_um"]) / 5)
    audit.require(correct_delta, cid + "/dependency_check/expected_mean_delta_um", "Mean delta metadata disagrees with exact independent means or perturbation/5", "dependency_metadata_checks")


def check_transform(case, cases, references, audit):
    tr = case["transformation"]
    cid, kind = case["case_id"], tr["kind"]
    sid = tr["source_case_id"]
    source = cases[sid]
    old, new = references[sid], references[cid]
    parameters = tr.get("parameters", {})
    old_input, new_input = normalized_observations(source), normalized_observations(case)
    expected_input = dict(old_input)
    if kind == "swap_directions":
        expected_input = {(pid, "down" if direction == "up" else "up", repeat): value for (pid, direction, repeat), value in old_input.items()}
    elif kind == "negate":
        expected_input = {key: -value for key, value in old_input.items()}
    elif kind == "offset":
        delta = Fraction(parameters["amount_um"])
        expected_input = {key: value + delta for key, value in old_input.items()}
    elif kind == "scale":
        factor = Fraction(parameters["factor"])
        audit.require(factor > 0, cid, "Metamorphic scale must be positive", "transformation_checks")
        expected_input = {key: value * factor for key, value in old_input.items()}
    elif kind == "change_observation":
        key = (parameters["position_id"], parameters["direction"], parameters["repeat"])
        expected_input[key] += Fraction(parameters["delta_um"])
    elif kind == "permute":
        audit.require([p["position_id"] for p in case["positions"]] == parameters["position_ids"], cid, "Wrong position permutation", "transformation_checks")
    elif kind != "unit_conversion":
        audit.require(False, cid, "Unknown transformation kind: " + kind, "transformation_checks")
    audit.require(new_input == expected_input, cid, "Transformed exact input does not match its declared transformation", "transformation_checks")
    old_coords = {p["position_id"]: Fraction(p["target_mm"]) for p in source["positions"]}
    new_coords = {p["position_id"]: Fraction(p["target_mm"]) for p in case["positions"]}
    audit.require(old_coords == new_coords, cid, "Position identity/coordinate association changed", "transformation_checks")
    old_rows = {p["position_id"]: p for p in old["positions"]}
    changed = {"positions": {}, "axis": []}
    for current in new["positions"]:
        previous = old_rows[current["position_id"]]
        pid = current["position_id"]
        changed_fields = []
        for field in POSITION_FIELDS:
            target = previous[field]
            if kind == "swap_directions":
                opposite = field.replace("_up", "_down") if "_up" in field else field.replace("_down", "_up")
                target = -previous[field] if field == "B_i" else previous[opposite]
            elif kind == "negate":
                if field.startswith("mean_") or field == "B_i":
                    target = -target
                elif field.startswith("lower_"):
                    target = -previous[field.replace("lower_", "upper_")]
                elif field.startswith("upper_"):
                    target = -previous[field.replace("upper_", "lower_")]
            elif kind == "offset" and (field.startswith("mean_") or field.startswith("lower_") or field.startswith("upper_")):
                target += qmp(Fraction(parameters["amount_um"]))
            elif kind == "scale":
                factor = qmp(Fraction(parameters["factor"]))
                target *= factor ** (2 if field.startswith("variance_") else 1)
            elif kind == "change_observation" and pid == parameters["position_id"]:
                if field == "mean_" + parameters["direction"]:
                    target += qmp(Fraction(parameters["delta_um"])) / 5
                elif field == "mean_both":
                    target += qmp(Fraction(parameters["delta_um"])) / 10
                elif field == "B_i":
                    target += (1 if parameters["direction"] == "up" else -1) * qmp(Fraction(parameters["delta_um"])) / 5
                elif field.endswith("_" + ("down" if parameters["direction"] == "up" else "up")):
                    pass
                else:
                    # Already independently recomputed in check_case; no false
                    # claim that every dependent maximum necessarily changes.
                    target = current[field]
            audit.require(numerical_close(current[field], target), cid + "/" + pid + "/" + field, "Metamorphic result relation failed", "transformation_checks")
            if not numerical_close(current[field], previous[field], digits=85):
                changed_fields.append(field)
        if changed_fields:
            changed["positions"][pid] = changed_fields
    for field in AXIS_FIELDS:
        target = old["axis"][field]
        if kind == "swap_directions":
            opposite = field.replace("_up", "_down") if "_up" in field else field.replace("_down", "_up")
            target = -target if field == "Bbar" else old["axis"][opposite]
        elif kind == "negate" and field == "Bbar":
            target = -target
        elif kind == "scale":
            target *= qmp(Fraction(parameters["factor"]))
        elif kind == "change_observation":
            if field == "Bbar":
                target += (1 if parameters["direction"] == "up" else -1) * qmp(Fraction(parameters["delta_um"])) / (5 * len(new["positions"]))
            else:
                target = new["axis"][field]
        audit.require(numerical_close(new["axis"][field], target), cid + "/axis/" + field, "Axis metamorphic relation failed", "transformation_checks")
        if not numerical_close(new["axis"][field], old["axis"][field], digits=85):
            changed["axis"].append(field)
    if kind == "change_observation" and "global-maximum" in cid:
        target = [{"position_id": parameters["position_id"], "direction": parameters["direction"]}]
        for field in ("mean_max", "upper_max"):
            audit.require(new["extrema"][field] == target and new["extrema"][field] != old["extrema"][field], cid, "Intended global maximum did not move to the changed observation's series", "transformation_checks")
    if kind == "change_observation" and "global-minimum" in cid:
        target = [{"position_id": parameters["position_id"], "direction": parameters["direction"]}]
        for field in ("mean_min", "lower_min"):
            audit.require(new["extrema"][field] == target and new["extrema"][field] != old["extrema"][field], cid, "Intended global minimum did not move to the changed observation's series", "transformation_checks")
    if kind == "change_observation":
        check_dependency_metadata(case, old, new, audit)
    audit.transformations.append({"case_id": cid, "source_case_id": sid, "kind": kind, "changed_fields": changed})


def checker_self_tests(cases, audit):
    """Two small in-memory corruptions prove that comparison failures reject.

    No public fixture bytes are changed. Isolated Audit instances keep these
    intentional failures out of the genuine fixture verification counts.
    """
    numerical_case = deepcopy(cases.get("T05-analytic-scatter", next(iter(cases.values()))))
    with localcontext() as context:
        context.prec = 110
        numerical_case["expected"]["axis"]["A"] = str(Decimal(numerical_case["expected"]["axis"]["A"]) + 1)
    branch_case = deepcopy(cases.get("T07-repeatability-branches", next(iter(cases.values()))))
    first_row = branch_case["expected"]["positions"][0]
    first_row["active_R_branches"] = ["R_i_up"] if first_row["active_R_branches"] != ["R_i_up"] else ["C_i"]
    tasks = [
        ("altered_expected_A_plus_one", numerical_case, numerical_case["case_id"] + "/axis/A", "Serialized value differs"),
        ("altered_active_R_branch", branch_case, branch_case["case_id"] + "/" + first_row["position_id"], "Exact active R branches disagree"),
    ]
    for name, altered, expected_location, expected_detail in tasks:
        isolated = Audit()
        check_case(altered, isolated)
        detected = any(error["location"] == expected_location and error["detail"].startswith(expected_detail) for error in isolated.errors)
        audit.require(detected, "checker_self_test/" + name, "Checker did not reject an intentionally corrupted in-memory fixture", "checker_self_tests")
        audit.checker_self_tests.append({"test": name, "detected": detected, "error_count": len(isolated.errors),
                                         "expected_error_location": expected_location,
                                         "actual_error_locations": [error["location"] for error in isolated.errors],
                                         "public_fixture_modified": False})


def mathematical_mutants(references, audit):
    """Demonstrate sensitivity; these are formula mutants, not production tests."""
    witnesses = {}
    def kill(name, wrong, correct, cid, field):
        if name not in witnesses and not numerical_close(wrong, correct, digits=50):
            witnesses[name] = {"mutant": name, "detected": True, "case_id": cid, "field": field}
    for cid, result in references.items():
        a, rows = result["axis"], result["positions"]
        kill("A_as_max_of_directional_A", max(a["A_up"], a["A_down"]), a["A"], cid, "A")
        kill("E_as_max_of_directional_E", max(a["E_up"], a["E_down"]), a["E"], cid, "E")
        kill("B_without_absolute_value", max(p["B_i"] for p in rows), a["B"], cid, "B")
        kill("Bbar_as_mean_absolute_B_i", mp.fsum(abs(p["B_i"]) for p in rows) / len(rows), a["Bbar"], cid, "Bbar")
        kill("axis_R_min_instead_of_max", min(p["R_i"] for p in rows), a["R"], cid, "R")
        kill("directional_outputs_interchanged", a["A_down"], a["A_up"], cid, "A_up")
        uppers = [p[f"upper_{direction}"] for p in rows for direction in ("up", "down")]
        lowers = [p[f"lower_{direction}"] for p in rows for direction in ("up", "down")]
        kill("A_lower_max_instead_of_min", max(uppers) - max(lowers), a["A"], cid, "A")
        if len(rows) > 11:
            kill("hardcoded_first_11_positions", mp.fsum(p["B_i"] for p in rows[:11]) / 11, a["Bbar"], cid, "Bbar")
        for p in rows:
            loc = p["position_id"] + "/"
            kill("reversal_sign_down_minus_up", -p["B_i"], p["B_i"], cid, loc + "B_i")
            kill("R_i_cross_candidate_only", p["C_i"], p["R_i"], cid, loc + "R_i")
            kill("R_i_unilateral_candidates_only", max(p["R_i_up"], p["R_i_down"]), p["R_i"], cid, loc + "R_i")
            kill("R_i_min_instead_of_max", min(p["C_i"], p["R_i_up"], p["R_i_down"]), p["R_i"], cid, loc + "R_i")
            for direction in ("up", "down"):
                s = p["series"][direction]
                kill("variance_divisor_5", s["sd"] * mp.sqrt(mp.mpf(4) / 5), s["sd"], cid, loc + "sd_" + direction)
                kill("repeatability_factor_2", 2 * s["sd"], p["R_i_" + direction], cid, loc + "R_i_" + direction)
                kill("range_based_SD_mixed_in", mp.mpf("0.4299") * (max(s["numeric"]) - min(s["numeric"])), s["sd"], cid, loc + "sd_" + direction)
                kill("mean_replaced_by_constant_1", mp.mpf(1), s["mean"], cid, loc + "mean_" + direction)
                for index in range(5):
                    wrong = mp.fsum(s["numeric"][:index] + s["numeric"][index + 1:]) / 4
                    kill(f"ignore_{direction}_observation_{index + 1}", wrong, s["mean"], cid, loc + "mean_" + direction)
    expected = ["A_as_max_of_directional_A", "E_as_max_of_directional_E", "B_without_absolute_value", "Bbar_as_mean_absolute_B_i",
                "axis_R_min_instead_of_max", "directional_outputs_interchanged", "A_lower_max_instead_of_min", "hardcoded_first_11_positions",
                "reversal_sign_down_minus_up", "R_i_cross_candidate_only", "R_i_unilateral_candidates_only", "R_i_min_instead_of_max",
                "variance_divisor_5", "repeatability_factor_2", "range_based_SD_mixed_in", "mean_replaced_by_constant_1"]
    expected += [f"ignore_{direction}_observation_{index}" for direction in ("up", "down") for index in range(1, 6)]
    for name in expected:
        record = witnesses.get(name, {"mutant": name, "detected": False})
        audit.mutation_results.append(record)
        audit.require(record["detected"], "mutants/" + name, "Fixture collection did not detect this mathematical defect", "mathematical_mutants")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    audit = Audit()
    cases = {}
    for file in sorted((args.fixtures / "cases").rglob("*.json")):
        document = json.loads(file.read_text(encoding="utf-8"))
        if document.get("category") not in ("valid", "transformed"):
            continue
        identifier = document.get("case_id")
        audit.require(identifier not in cases, str(file.relative_to(args.fixtures)), "Duplicate fixture case_id")
        cases[identifier] = document
    references = {}
    for cid, case in cases.items():
        try:
            references[cid] = check_case(case, audit)
        except Exception as error:
            audit.errors.append({"location": cid, "detail": type(error).__name__ + ": " + str(error)})
    for cid, case in cases.items():
        if "transformation" in case and cid in references:
            try:
                check_transform(case, cases, references, audit)
            except Exception as error:
                audit.errors.append({"location": cid + "/transformation", "detail": type(error).__name__ + ": " + str(error)})
    mathematical_mutants(references, audit)
    if cases:
        checker_self_tests(cases, audit)
    sensitivities = {(c["transformation"]["parameters"]["direction"], c["transformation"]["parameters"]["repeat"])
                     for c in cases.values() if c.get("transformation", {}).get("kind") == "change_observation"}
    audit.require(set((d, r) for d in ("up", "down") for r in range(1, 6)).issubset(sensitivities), "M06", "All five observation indices in both directions need explicit perturbation pairs", "coverage_checks")
    audit.require(bool(cases), "fixtures", "No positive fixture files found", "coverage_checks")
    sizes = sorted(set(len(c["positions"]) for c in cases.values()))
    audit.require(5 in sizes and any(m > 11 for m in sizes), "T08", "Need m=5 and m>11", "coverage_checks")
    for branch in ("C_i", "R_i_up", "R_i_down"):
        audit.require(audit.branch_counts[branch] > 0, "T07", "Missing strict R branch " + branch, "coverage_checks")
    report = {
        "schema_version": "vsz-verification-report-1.0", "status": "passed" if not audit.errors else "failed",
        "method": {"implementation": "independent mpmath verifier", "python": platform.python_version(), "mpmath": mp.__version__,
                   "working_decimal_digits": WORK_DIGITS, "fixture_significant_digits": OUTPUT_DIGITS,
                   "variance": "sum over j<k of (x_j-x_k)^2 / 20", "R_i": "max(U_up,U_down)-min(L_up,L_down)",
                   "serialized_comparison": "exact equality after independent rounding to 70 significant decimal digits",
                   "exact_predicates": "Fraction certificates, branch/band-extremum squaring predicates, radical-sum equality and rational interval bounds for R maxima; no epsilon tie classification",
                   "imports_generator": False},
        "positive_files_checked": len(references), "by_category": dict(Counter(c["category"] for c in cases.values())),
        "positions_checked": sum(len(c["positions"]) for c in cases.values()), "position_counts": sizes,
        "checks": dict(sorted(audit.counts.items())), "max_relative_serialization_error": mp.nstr(audit.max_relative_serialization_error, 12),
        "R_branch_occurrences": dict(sorted(audit.branch_counts.items())), "cases": audit.case_results,
        "transformations": audit.transformations, "mathematical_mutants": audit.mutation_results,
        "checker_self_tests": audit.checker_self_tests,
        "errors": audit.errors,
        "limits": ["Synthetic arithmetic validation only; no machine-test metrological approval.",
                   "Mathematical mutants demonstrate fixture sensitivity, not executed mutation testing of future production code.",
                   "Invalid fixtures and binary64 stress experiments are checked by their separate tools."]}
    output = args.output or (args.fixtures / "checks" / "independent-results.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "positive_files_checked": len(references), "positions_checked": report["positions_checked"], "serialized_numeric_values": audit.counts["serialized_numeric_values"], "errors": len(audit.errors), "output": str(output)}, ensure_ascii=False))
    if audit.errors:
        print(json.dumps(audit.errors[:20], ensure_ascii=False, indent=2))
    return 0 if not audit.errors else 1


if __name__ == "__main__":
    sys.exit(main())
