#!/usr/bin/env python3
"""Independent structural/domain and exact rational rounding fixture checks.

This analytical checker imports no fixture generator or numerical oracle. It
classifies actual input conditions before reading expected_validation. These
human domain classes are fixture expectations, not production exception names.
No invalid measurement is replaced by zero and no axis outputs are fabricated.
Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from fractions import Fraction
from pathlib import Path
import re
import sys


DECIMAL = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z")
AXIS_FIELDS = ("A", "A_up", "A_down", "E", "E_up", "E_down", "M",
               "R", "R_up", "R_down", "B", "Bbar")
POSITION_FIELDS = ("mean_up", "mean_down", "mean_both", "variance_up",
                   "variance_down", "sd_up", "sd_down", "lower_up", "upper_up",
                   "lower_down", "upper_down", "B_i", "R_i_up", "R_i_down",
                   "C_i", "R_i")
METHOD = "sample-n-minus-1"
PROFILE = "gost-27843-2006-linear-axis-le-2000-v1"


def number(text):
    """Exact full-string decimal parsing. Bool, blanks, NaN and Infinity fail."""
    if not isinstance(text, str) or DECIMAL.fullmatch(text) is None:
        raise ValueError("Finite complete decimal string required")
    return Fraction(text)


def digest(data):
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def classify_inputs(data):
    """Use input observations/context only; do not consult case ID or expected."""
    findings = []
    normalized = []

    def issue(level, name, path, evidence, arithmetic=None):
        findings.append({"level": level, "class_ru": name, "path": path,
                         "evidence": evidence,
                         "arithmetic": arithmetic or
                         ("not-permitted-for-selected-profile" if level == "input-error"
                          else "defined-for-preliminary-analysis")})

    units = data.get("units", {})
    factor = {"um": Fraction(1), "mm": Fraction(1000)}.get(units.get("deviation"))
    if factor is None or units.get("coordinate") != "mm":
        issue("input-error", "Неопределённая единица измерения", "units",
              {"coordinate": units.get("coordinate"), "deviation": units.get("deviation")})

    rows = data.get("positions")
    if not isinstance(rows, list):
        issue("input-error", "Некорректная структура списка позиций", "positions",
              {"type": type(rows).__name__})
        rows = []
    elif not rows:
        issue("mathematical-error", "Осевая арифметика не определена", "positions",
              {"position_count": 0, "undefined_operations": ["min", "max", "sum_B_i/m"]},
              arithmetic="undefined")

    seen_ids, seen_coordinates = set(), set()
    for i, row in enumerate(rows):
        p = "positions/" + str(i)
        if not isinstance(row, dict):
            issue("input-error", "Некорректная структура позиции", p,
                  {"type": type(row).__name__})
            continue
        identity = row.get("position_id")
        if not isinstance(identity, str) or not identity or identity in seen_ids:
            issue("input-error", "Нарушена уникальность позиции или повторения",
                  p + "/position_id", {"position_id": identity})
        if isinstance(identity, str):
            seen_ids.add(identity)
        try:
            coordinate = number(row.get("target_mm"))
            if coordinate in seen_coordinates:
                issue("input-error", "Дубликат заданной координаты требует разбора плана",
                      p + "/target_mm", {"target_mm": row.get("target_mm"),
                                           "exact_value": str(coordinate)})
            seen_coordinates.add(coordinate)
        except (ValueError, TypeError):
            issue("input-error", "Некорректный числовой ввод", p + "/target_mm",
                  {"value": row.get("target_mm")})

        directions = set(row) - {"position_id", "target_mm"}
        if directions != {"up", "down"}:
            issue("input-error", "Неоднозначная принадлежность направлению", p,
                  {"series_names": sorted(directions), "required": ["up", "down"]})
        for direction in ("up", "down"):
            if direction not in row:
                continue  # Missing direction is already diagnosed; never fabricate a series.
            series = row[direction]
            path = p + "/" + direction
            if not isinstance(series, list):
                issue("input-error", "Некорректная структура серии", path,
                      {"type": type(series).__name__})
                continue
            if len(series) != 5:
                issue("input-error", "Несоответствие числа повторений", path,
                      {"observed_count": len(series), "required_count": 5})
            repeats = [o.get("repeat") if isinstance(o, dict) else None for o in series]
            if len(series) == 5 and (any(type(j) is not int for j in repeats)
                                      or sorted(j for j in repeats if type(j) is int)
                                      != [1, 2, 3, 4, 5]):
                issue("input-error", "Нарушена уникальность позиции или повторения", path,
                      {"repeat_indices": repeats, "required": [1, 2, 3, 4, 5]})
            for j, observation in enumerate(series):
                op = path + "/" + str(j)
                if not isinstance(observation, dict) or "value" not in observation:
                    issue("input-error", "Неполное обязательное наблюдение", op,
                          {"value_field_present": False})
                    continue
                value = observation["value"]
                try:
                    exact_value = number(value)
                except (ValueError, TypeError):
                    issue("input-error", "Некорректный числовой ввод", op + "/value",
                          {"value": value, "json_type": type(value).__name__})
                    continue
                if factor is not None:
                    normalized.append((identity, direction, observation.get("repeat"),
                                       str(exact_value * factor)))

    if 0 < len(rows) < 5:
        issue("applicability-warning", "Недостаточное число позиций для процедуры",
              "positions", {"position_count": len(rows), "procedure_minimum": 5})
    context = data.get("context", {})
    try:
        travel = number(context.get("full_travel_mm"))
        if travel <= 0 or travel > 2000:
            issue("applicability-warning", "Известный выход за область выбранного профиля",
                  "context/full_travel_mm",
                  {"full_travel_mm": context.get("full_travel_mm"),
                   "supported_interval": "0 < L <= 2000 mm", "known_violation": True})
    except (TypeError, ValueError):
        issue("applicability-warning", "Полный ход не установлен", "context/full_travel_mm",
              {"value": context.get("full_travel_mm")})
    if context.get("report_metadata") == "missing":
        missing = context.get("missing_report_fields", [])
        issue("report-warning", "Недостаточность сведений для полноценного отчёта",
              "context/missing_report_fields", {"missing_fields": missing})
        if set(missing) & {"instrument", "temperature", "warmup"}:
            issue("applicability-warning", "Условия испытания также не подтверждены",
                  "context/missing_report_fields",
                  {"reason": "Прибор, температура и прогрев нужны также для применимости."})

    blocking = [f for f in findings if f["level"] in ("input-error", "mathematical-error")]
    primary = (blocking or findings or [None])[0]
    return {"primary": primary, "findings": findings,
            "normalized_observations": normalized if not blocking else None,
            "position_count": len(rows),
            "complete_numeric_input": not blocking,
            "arithmetic": primary["arithmetic"] if primary else "defined",
            "procedure_confirmed": False,
            "report_confirmed": False,
            "zero_substitution_performed": False}


def nearest_even(value, quantum):
    """Exact rational nearest grid node, with signed symmetric ties to even."""
    assert quantum > 0
    scaled = abs(value / quantum)
    n, remainder = divmod(scaled.numerator, scaled.denominator)
    twice = 2 * remainder
    if twice > scaled.denominator or (twice == scaled.denominator and n % 2):
        n += 1
    return (-n if value < 0 else n) * quantum


def fixed_decimal(value, quantum, negative_source=False):
    """Render a terminating rational using the quantum's required scale."""
    denominator = quantum.denominator
    twos = fives = 0
    while denominator % 2 == 0:
        twos += 1
        denominator //= 2
    while denominator % 5 == 0:
        fives += 1
        denominator //= 5
    assert denominator == 1
    digits = max(twos, fives)
    scaled = abs(value) * 10 ** digits
    assert scaled.denominator == 1
    body = str(scaled.numerator).zfill(digits + 1)
    if digits:
        body = body[:-digits] + "." + body[-digits:]
    return ("-" if value < 0 or (value == 0 and negative_source) else "") + body


def check_rounding(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["rule"] == "nearest-ties-to-even"
    results = []
    for case in data["cases"]:
        decimal_value = number(case["source_decimal"])
        quantum = number(case["quantum"])
        decimal_result = nearest_even(decimal_value, quantum)
        decimal_text = fixed_decimal(decimal_result, quantum, decimal_value < 0)
        binary = float(case["source_decimal"])
        assert math.isfinite(binary)
        exact_binary = Fraction(*binary.as_integer_ratio())
        assert number(case["binary64_exact_decimal"]) == exact_binary
        assert binary.hex() == case["binary64_hex"]
        binary_result = nearest_even(exact_binary, quantum)
        binary_text = fixed_decimal(binary_result, quantum, exact_binary < 0)
        assert decimal_text == case["exact_decimal_expected"], case
        assert binary_text == case["exact_binary64_expected"], case
        results.append({"source_decimal": case["source_decimal"], "quantum": case["quantum"],
                        "exact_decimal_result": decimal_text,
                        "exact_binary64_result": binary_text,
                        "binary64_exact_ratio": str(exact_binary), "passed": True})
    return results


def check_fixture_metadata(data, category):
    assert data["schema_version"] == "vsz-fixtures-1.0"
    assert data["profile_id"] == PROFILE
    assert data["sd_method"] == METHOD
    assert data["category"] == category
    assert isinstance(data["case_id"], str) and data["case_id"]
    assert isinstance(data["coverage"], list) and data["coverage"]
    provenance = data["provenance"]
    assert provenance["origin"].startswith("independently-synthesized")
    assert provenance["private_measurements_used"] is False
    assert provenance["standard_example_observations_used"] is False
    if category != "invalid":
        assert data["units"]["expected"] == "um"
        assert data["units"]["variance"] == "um2"
        assert data["oracle"]["working_decimal_digits"] >= 60
        assert data["oracle"]["serialized_significant_digits"] >= 60
        assert data["oracle"]["method_approval"] == "recommendation-awaiting-metrologist"
        expected = data["expected"]
        assert set(expected["axis"]) == set(AXIS_FIELDS)
        for value in expected["axis"].values():
            number(value)
        assert [p["position_id"] for p in expected["positions"]] == [
            p["position_id"] for p in data["positions"]]
        for result in expected["positions"]:
            for field in POSITION_FIELDS:
                number(result[field])
            assert result["active_R_branches"]
            assert set(result["active_R_branches"]) <= {"C_i", "R_i_up", "R_i_down"}
    else:
        assert "expected" not in data and "exact" not in data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path,
                        default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.fixtures.resolve()
    cases = {}
    classified = {}
    records = []
    counts = Counter()
    observed_numeric_positions = observed_numeric_values = 0
    for category in ("valid", "transformed", "invalid"):
        for path in sorted((root / "cases" / category).glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            check_fixture_metadata(data, category)
            identity = data["case_id"]
            assert identity not in cases
            assert path.stem == identity
            cases[identity] = data
            result = classify_inputs(data)
            classified[identity] = result
            counts[category] += 1
            if category == "invalid":
                expected = data["expected_validation"]
                assert result["primary"] is not None, identity
                for field in ("level", "class_ru", "arithmetic"):
                    assert result["primary"][field] == expected[field], (
                        identity, field, result["primary"][field], expected[field])
                assert expected["full_profile_result_permitted"] is False
                assert expected["fabricated_numeric_results_permitted"] is False
                assert expected["production_exception_name_defined"] is False
                counts["negative_" + result["primary"]["level"]] += 1
            else:
                assert result["complete_numeric_input"], (identity, result["findings"])
                assert not result["findings"], (identity, result["findings"])
                assert result["position_count"] >= 5
                observed_numeric_positions += result["position_count"]
                observed_numeric_values += len(result["normalized_observations"])
            primary_inputs = {k: data[k] for k in ("positions", "units", "context", "sd_method")}
            records.append({"case_id": identity, "category": category,
                            "input_sha256": digest(primary_inputs),
                            "position_count": result["position_count"],
                            "complete_numeric_input": result["complete_numeric_input"],
                            "arithmetic": result["arithmetic"],
                            "findings": result["findings"],
                            "zero_substitution_performed": False,
                            "numeric_results_present": "expected" in data,
                            "passed": True})

    # Verify source links exist and are not self-references; check units from
    # each original decimal string, rather than comparing rounded expectations.
    conversion_records = []
    for identity, data in cases.items():
        source = data["provenance"].get("source_case_id")
        if source:
            assert source in cases and source != identity
        transformation = data.get("transformation", {})
        if transformation:
            source = transformation["source_case_id"]
            assert source in cases and source != identity
        if transformation.get("kind") == "unit_conversion":
            original, transformed = cases[source], data
            assert [(p["position_id"], number(p["target_mm"])) for p in original["positions"]] == [
                (p["position_id"], number(p["target_mm"])) for p in transformed["positions"]]
            assert classified[source]["normalized_observations"] == classified[identity]["normalized_observations"]
            conversion_records.append({"case_id": identity, "source_case_id": source,
                                       "exact_normalized_observation_equalities":
                                       len(classified[identity]["normalized_observations"]),
                                       "coordinates_identity_and_repeats_preserved": True,
                                       "passed": True})

    rounding = check_rounding(root / "rounding-cases.json")
    output = {"check": "independent-input-validation-and-rational-rounding",
              "schema_version": "vsz-fixtures-1.0",
              "status": "passed", "counts": dict(counts),
              "positive_positions": observed_numeric_positions,
              "positive_observations": observed_numeric_values,
              "rounding_examples": len(rounding),
              "method": "Actual input traversal, strict decimal grammar and Fraction normalization; exact rational nearest-even rounding. No generator/oracle imports.",
              "limits": [
                  "This is a fixture checker, not the future production validator or final API contract.",
                  "Synthetic provenance declarations and internal source links were checked; arithmetic cannot certify real-world origin.",
                  "No synthetic case confirms physical test applicability or a completed report.",
                  "Instrument, temperature and warmup omissions affect applicability as well as reporting; the pure report example uses administrative fields.",
                  "A complete numeric input with m=1..4 or out-of-profile full travel allows preliminary arithmetic only.",
                  "This checker does not compute numerical axis outputs for rejected or warning cases."],
              "cases": records, "exact_unit_conversions": conversion_records,
              "rounding": rounding}
    destination = args.output or root / "checks" / "validation-results.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "passed", "counts": dict(counts),
                      "positive_positions": observed_numeric_positions,
                      "positive_observations": observed_numeric_values,
                      "rounding_examples": len(rounding), "output": str(destination)},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
