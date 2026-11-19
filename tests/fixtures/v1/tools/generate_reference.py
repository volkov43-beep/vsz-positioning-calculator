#!/usr/bin/env python3
"""Synthetic reference fixtures, iteration 03A.

Primary oracle: exact Fraction sums/variances, Decimal.sqrt at 100 digits.
No Excel, original measurements, TypeScript, or binary floats are inputs.
Use --check for byte-for-byte reproduction, or --output DIR to regenerate.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
from fractions import Fraction
from pathlib import Path

SCHEMA = "vsz-fixtures-1.0"
PROFILE = "gost-27843-2006-linear-axis-le-2000-v1"
METHOD = "sample-n-minus-1"
HEAD = "b94c33585d0f49b955a72f3b1fc30edb6b8490d8"
# Ordered case digests from the independent checks repeated for publication in 03B.
VERIFIED_CASE_DIGEST = "3e5f234a04478b81cfb7f0bf0fa1d5a2ab2c9d14d716c2d71a3ebb650f756380"
PRECISION = 100
OUTPUT_DIGITS = 70
AXIS_KEYS = ("A", "A_up", "A_down", "E", "E_up", "E_down",
             "M", "R", "R_up", "R_down", "B", "Bbar")
POSITION_KEYS = ("mean_up", "mean_down", "mean_both", "variance_up",
                 "variance_down", "sd_up", "sd_down", "lower_up",
                 "upper_up", "lower_down", "upper_down", "B_i",
                 "R_i_up", "R_i_down", "C_i", "R_i")


def rational_text(value):
    q = Fraction(value)
    return str(q.numerator) if q.denominator == 1 else f"{q.numerator}/{q.denominator}"


def dec(q):
    q = Fraction(q)
    return Decimal(q.numerator) / Decimal(q.denominator)


def decimal_text(value, digits=OUTPUT_DIGITS):
    with localcontext() as ctx:
        ctx.prec = digits
        ctx.rounding = ROUND_HALF_EVEN
        d = +value if isinstance(value, Decimal) else +dec(Fraction(value))
        if d == 0:
            return "0"
        # Fixed notation remains compact for this package's -12..6 exponents.
        return format(d, "f").rstrip("0").rstrip(".") if d.as_tuple().exponent < 0 else format(d, "f")


def exact_decimal(q):
    """Serialize a terminating rational input exactly; never round an input."""
    q = Fraction(q)
    den = q.denominator
    for prime in (2, 5):
        while den % prime == 0:
            den //= prime
    if den != 1:
        raise ValueError("Input recipe must produce a terminating decimal")
    with localcontext() as ctx:
        ctx.prec = max(100, len(str(abs(q.numerator))) + len(str(q.denominator)) + 10)
        return decimal_text(dec(q), ctx.prec)


def series(values):
    assert len(values) == 5
    return [{"repeat": j + 1, "value": exact_decimal(Fraction(str(v)))}
            for j, v in enumerate(values)]


def position(pid, target, up, down):
    return {"position_id": pid, "target_mm": exact_decimal(Fraction(str(target))),
            "up": series(up), "down": series(down)}


def simple_positions(rows):
    m = len(rows)
    return [position(f"p{i + 1:02d}", Fraction(i * 1000, m - 1), up, down)
            for i, (up, down) in enumerate(rows)]


def constant(v):
    return [v] * 5


def generated_positions(m):
    """P05 integer recipe, also used for the explicit m=12 fixture."""
    up_pattern = (-2, -1, 0, 1, 2)
    down_pattern = (-2, 0, 0, 0, 2)
    return [
        position(
            f"p{i + 1:05d}", Fraction(i, 10),
            [Fraction(100 * ((17 * i) % 101 - 50) + (i % 7 + 1) * p, 1000)
             for p in up_pattern],
            [Fraction(125 * ((29 * i) % 97 - 48) + (i % 5 + 1) * p, 1000)
             for p in down_pattern],
        ) for i in range(m)
    ]


def calculate(positions, deviation_unit="um"):
    """Compute all outputs; rational operations precede square roots."""
    multiplier = {"um": Fraction(1), "mm": Fraction(1000)}[deviation_unit]
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        rows, exact_rows = [], []
        for p in positions:
            rational = {}
            r = {"position_id": p["position_id"]}
            for d in ("up", "down"):
                xs = [Fraction(o["value"]) * multiplier for o in p[d]]
                assert len(xs) == 5
                mu = sum(xs, Fraction(0)) / 5
                variance = sum(((x - mu) ** 2 for x in xs), Fraction(0)) / 4
                rational[f"mean_{d}"] = mu
                rational[f"variance_{d}"] = variance
                r[f"mean_{d}"] = dec(mu)
                r[f"variance_{d}"] = dec(variance)
                r[f"sd_{d}"] = dec(variance).sqrt()
                r[f"lower_{d}"] = dec(mu) - 2 * r[f"sd_{d}"]
                r[f"upper_{d}"] = dec(mu) + 2 * r[f"sd_{d}"]
                r[f"R_i_{d}"] = 4 * r[f"sd_{d}"]
            rational["mean_both"] = (rational["mean_up"] + rational["mean_down"]) / 2
            rational["B_i"] = rational["mean_up"] - rational["mean_down"]
            r["mean_both"] = dec(rational["mean_both"])
            r["B_i"] = dec(rational["B_i"])
            r["C_i"] = 2 * r["sd_up"] + 2 * r["sd_down"] + abs(r["B_i"])
            candidates = ("C_i", "R_i_up", "R_i_down")
            r["R_i"] = max(r[k] for k in candidates)
            r["active_R_branches"] = [k for k in candidates if r[k] == r["R_i"]]
            rows.append(r)
            exact_rows.append({"position_id": p["position_id"],
                               **{k: rational_text(v) for k, v in rational.items()}})
        assert rows
        def span(key):
            return max(r[key] for r in rows) - min(r[key] for r in rows)
        axis = {
            "A": max(r[f"upper_{d}"] for r in rows for d in ("up", "down"))
                 - min(r[f"lower_{d}"] for r in rows for d in ("up", "down")),
            "A_up": max(r["upper_up"] for r in rows) - min(r["lower_up"] for r in rows),
            "A_down": max(r["upper_down"] for r in rows) - min(r["lower_down"] for r in rows),
            "E": max(r[f"mean_{d}"] for r in rows for d in ("up", "down"))
                 - min(r[f"mean_{d}"] for r in rows for d in ("up", "down")),
            "E_up": span("mean_up"),
            "E_down": span("mean_down"),
            "M": span("mean_both"),
            "R": max(r["R_i"] for r in rows),
            "R_up": max(r["R_i_up"] for r in rows),
            "R_down": max(r["R_i_down"] for r in rows),
            "B": max(abs(r["B_i"]) for r in rows),
            "Bbar": dec(sum((Fraction(r["B_i"]) for r in exact_rows), Fraction(0)) / len(rows)),
        }
        extrema = {}
        def trace(name, pairs, operation):
            extreme = operation(v for _, _, v in pairs)
            extrema[name] = [
                {"position_id": pid, "direction": d}
                for pid, d, v in pairs if v == extreme
            ]
        for field, label in (("mean", "mean"), ("lower", "lower"), ("upper", "upper")):
            operations = (("min", min), ("max", max)) if field == "mean" else (
                ("min", min),) if field == "lower" else (("max", max),)
            for suffix, fn in operations:
                pairs = [(r["position_id"], d, r[f"{field}_{d}"])
                         for r in rows for d in ("up", "down")]
                trace(f"{label}_{suffix}", pairs, fn)
                for d in ("up", "down"):
                    trace(f"{label}_{suffix}_{d}", [p for p in pairs if p[1] == d], fn)
        for name, key, fn, direction, absolute in (
            ("mean_both_min", "mean_both", min, "both", False),
            ("mean_both_max", "mean_both", max, "both", False),
            ("R_max", "R_i", max, "both", False),
            ("R_up_max", "R_i_up", max, "up", False),
            ("R_down_max", "R_i_down", max, "down", False),
            ("B_abs_max", "B_i", max, "both", True),
        ):
            trace(name, [(r["position_id"], direction, abs(r[key]) if absolute else r[key])
                         for r in rows], fn)
        expected = {
            "positions": [
                {"position_id": r["position_id"],
                 **{k: decimal_text(r[k]) for k in POSITION_KEYS},
                 "active_R_branches": r["active_R_branches"]}
                for r in rows
            ],
            "axis": {k: decimal_text(axis[k]) for k in AXIS_KEYS},
            "extrema": extrema,
        }
        # These six fields are rational; derive without Decimal rounding.
        mu_u = [Fraction(r["mean_up"]) for r in exact_rows]
        mu_d = [Fraction(r["mean_down"]) for r in exact_rows]
        mu_b = [Fraction(r["mean_both"]) for r in exact_rows]
        bs = [Fraction(r["B_i"]) for r in exact_rows]
        exact_axis = {
            "E": max(mu_u + mu_d) - min(mu_u + mu_d),
            "E_up": max(mu_u) - min(mu_u),
            "E_down": max(mu_d) - min(mu_d),
            "M": max(mu_b) - min(mu_b),
            "B": max(abs(b) for b in bs),
            "Bbar": sum(bs, Fraction(0)) / len(bs),
        }
        return expected, {
            "positions": exact_rows,
            "axis_rational": {k: rational_text(v) for k, v in exact_axis.items()},
            "radical_rule": "sd_up=sqrt(variance_up); sd_down=sqrt(variance_down); subsequent formulas use unrounded radicals",
        }


def make_case(cid, rows, purpose, coverage, category="valid", unit="um", recipe=""):
    case = {
        "schema_version": SCHEMA, "case_id": cid, "category": category,
        "profile_id": PROFILE, "sd_method": METHOD,
        "coverage": coverage, "purpose_ru": purpose,
        "units": {"coordinate": "mm", "deviation": unit, "expected": "um", "variance": "um2"},
        "context": {"full_travel_mm": "1000",
                    "procedure_applicability": "not-established-by-synthetic-fixture",
                    "report_metadata": "synthetic-only"},
        "provenance": {
            "origin": "independently-synthesized",
            "recipe": recipe or purpose,
            "private_measurements_used": False,
            "standard_example_observations_used": False,
        },
        "positions": rows,
        "oracle": {
            "primary": "fractions.Fraction exact sums and centered variance; decimal.Decimal.sqrt",
            "working_decimal_digits": PRECISION,
            "serialized_significant_digits": OUTPUT_DIGITS,
            "rounding_of_serialization": "nearest-ties-to-even",
            "exact_source": "original input strings and exact rational mean/variance",
            "method_approval": "recommendation-awaiting-metrologist",
        },
    }
    case["expected"], case["exact"] = calculate(rows, unit)
    return case


def transform(base, cid, kind, parameters, purpose, coverage):
    rows = copy.deepcopy(base["positions"])
    unit = base["units"]["deviation"]
    if kind == "swap_directions":
        for p in rows:
            p["up"], p["down"] = p["down"], p["up"]
    elif kind in ("negate", "offset", "scale", "unit_conversion"):
        for p in rows:
            for d in ("up", "down"):
                for obs in p[d]:
                    value = Fraction(obs["value"])
                    if kind == "negate":
                        value = -value
                    elif kind == "offset":
                        value += Fraction(parameters["amount_um"])
                    elif kind == "scale":
                        value *= Fraction(parameters["factor"])
                    elif kind == "unit_conversion":
                        value /= 1000
                    obs["value"] = exact_decimal(value)
        if kind == "unit_conversion":
            unit = "mm"
    elif kind == "permute":
        by_id = {p["position_id"]: p for p in rows}
        rows = [by_id[pid] for pid in parameters["position_ids"]]
    elif kind == "change_observation":
        p = next(p for p in rows if p["position_id"] == parameters["position_id"])
        obs = next(o for o in p[parameters["direction"]] if o["repeat"] == parameters["repeat"])
        obs["value"] = exact_decimal(Fraction(obs["value"]) + Fraction(parameters["delta_um"]))
    else:
        raise ValueError(kind)
    case = make_case(cid, rows, purpose, coverage, "transformed", unit,
                     "Exact transformation of " + base["case_id"])
    case["transformation"] = {"kind": kind, "source_case_id": base["case_id"], "parameters": parameters}
    # Explicit sensitivity information is derived from already computed fields.
    if kind == "change_observation":
        old = {p["position_id"]: p for p in base["expected"]["positions"]}
        new = {p["position_id"]: p for p in case["expected"]["positions"]}
        pid = parameters["position_id"]
        case["dependency_check"] = {
            "expected_mean_delta_um": exact_decimal(Fraction(parameters["delta_um"]) / 5),
            "changed_position_fields": [k for k in POSITION_KEYS if old[pid][k] != new[pid][k]],
            "unchanged_other_positions": True,
            "changed_axis_fields": [k for k in AXIS_KEYS if base["expected"]["axis"][k] != case["expected"]["axis"][k]],
            "changed_extrema_fields": [k for k in base["expected"]["extrema"]
                                      if base["expected"]["extrema"][k] != case["expected"]["extrema"][k]],
        }
    return case


def invalid_case(base, cid, coverage, purpose, mutator, arithmetic, level, class_ru, reason):
    keys = ("schema_version", "profile_id", "sd_method", "units", "context", "positions")
    case = {k: copy.deepcopy(base[k]) for k in keys}
    case.update(case_id=cid, category="invalid", coverage=coverage, purpose_ru=purpose)
    case["provenance"] = {"origin": "independently-synthesized-invalid-mutation",
                          "source_case_id": base["case_id"],
                          "private_measurements_used": False,
                          "standard_example_observations_used": False}
    mutator(case)
    case["expected_validation"] = {
        "arithmetic": arithmetic,
        "level": level,
        "class_ru": class_ru,
        "reason_ru": reason,
        "full_profile_result_permitted": False,
        "fabricated_numeric_results_permitted": False,
        "production_exception_name_defined": False,
    }
    return case


def build_cases():
    cases = []
    def add(cid, rows, purpose, coverage, recipe=""):
        c = make_case(cid, rows, purpose, coverage, recipe=recipe)
        cases.append(c)
        return c
    zero = add("T01-zero", simple_positions([(constant(0), constant(0))] * 5),
               "Точные нули всех позиционных характеристик и 12 итогов.", ["T01", "T08"])
    add("T02-common-constant", simple_positions([(constant("7.25"), constant("7.25"))] * 5),
        "Общий ненулевой сдвиг; средние/границы 7.25, все 12 итогов нулевые.", ["T02"])
    add("T03-direction-constants", simple_positions([(constant(3), constant(-2))] * 5),
        "Постоянные разные направления, Bi=Bbar=5; A=E=R=B=5.", ["T03"])
    add("T04-negative-reversal",
        simple_positions([(constant(u), constant(d)) for u, d in zip((-4, -1, 0, -2, -3), (1, 3, 2, 3, 1))]),
        "Все Bi отрицательные, Bbar=-4; B=5, модуль не переносится на знаковую среднюю.", ["T04"])
    add("T05-analytic-scatter", simple_positions([
        ([-1, -1, 0, 1, 1], [-2, -2, 0, 2, 2]),
        ([1, 1, 2, 3, 3], [-1, -1, 1, 3, 3]),
        ([-5, -5, -3, -1, -1], [-2, -2, -1, 0, 0]),
        ([3, 3, 3, 3, 3], [0, 0, 2, 4, 4]),
        ([-2, -2, 1, 4, 4], [-1, -1, 0, 1, 1]),
    ]), "Серии c+[-a,-a,0,a,a] дают ровно s=|a|.", ["T05"],
        "Independently chosen integer centers and pattern [-a,-a,0,a,a].")
    outlier_rows = simple_positions([(constant(0), constant(0))] * 5)
    outlier_rows[2]["up"][4]["value"] = "20"
    add("T06-single-outlier", outlier_rows,
        "Единственный выброс 20 сохранён: mean=4, variance=80, s=4*sqrt(5).", ["T06"])
    add("T07-repeatability-branches", simple_positions([
        (constant(3), constant(-2)),
        ([-1, -1, 0, 1, 1], constant(0)),
        (constant(0), [-1, -1, 0, 1, 1]),
        ([1, 1, 2, 3, 3], constant(0)),
        (constant(0), [1, 1, 2, 3, 3]),
        ([-1, -1, 0, 1, 1], [-1, -1, 0, 1, 1]),
    ]), "C, R_up, R_down побеждают отдельно; затем C/up, C/down и тройное точное равенство.", ["T07", "T08"])
    rich = add("T08-variable-m12", generated_positions(12),
               "12 позиций по целочисленному модульному генератору; иррациональные s.", ["T08", "P05"],
               "P05 integer recipe, i=0..11; up denominator 1000 and pattern [-2,-1,0,1,2]; down pattern [-2,0,0,0,2].")
    extreme = add("T09-extrema-base", simple_positions([
        (constant(v), constant(v)) for v in (-2, 0, 1, 3, 2)
    ]), "Основа пар со сменой источника глобального максимума и минимума.", ["M06"])
    tiny = [Fraction(v, 10**12) for v in (-1, -1, 0, 1, 1)]
    add("P01-tiny-scatter", simple_positions([(tiny, tiny)] * 5),
        "Ненулевой s=10^-12 и R=4*10^-12 без большого фона.", ["P01"])
    for suffix, denominator in (("resolvable", 10**6), ("near-ulp", 10**10), ("collapsed", 10**12)):
        u = [Fraction(1000000) + Fraction(v, denominator) for v in (-1, -1, 0, 1, 1)]
        d = [Fraction(1000000) + Fraction(v, denominator) for v in (-2, -2, 0, 2, 2)]
        add("P02-offset-" + suffix, simple_positions([(u, d)] * 5),
            "Точный десятичный разброс на фоне 10^6; входное квантование binary64 проверяется отдельно.", ["P02"],
            f"Offset 1000000 plus integer pattern divided by {denominator}.")
    add("P02-mixed-scale", simple_positions([
        (constant(1000000), constant(1000000)),
        (tiny, constant(Fraction(2, 10**12))),
        (constant(1), constant(1)),
        (constant(-1), constant(-1)),
        (constant(0), constant(0)),
    ]), "Большой первый центр и малый разброс другой позиции; отделяет потерю вычислений от квантования входа.", ["P02"])

    for cid, kind, params, purpose, coverage in [
        ("M01-swap-directions", "swap_directions", {}, "Перестановка направлений; знаки Bi/Bbar меняются.", ["M01"]),
        ("M02-negate", "negate", {}, "Отрицание измерений; L становится -U, диапазоны сохраняются.", ["M02"]),
        ("M03-common-offset", "offset", {"amount_um": "123.456789012345"}, "Все 12 итогов сохраняются после общего сдвига.", ["M03"]),
        ("M04-positive-scale", "scale", {"factor": "2.5"}, "Длины масштабируются в 2.5 раза, дисперсии в 6.25.", ["M04"]),
        ("M05-permute-positions", "permute",
         {"position_ids": [rich["positions"][i]["position_id"] for i in (6, 0, 11, 3, 10, 2, 9, 1, 8, 4, 7, 5)]},
         "Порядок позиций меняется с сохранением идентичностей, координат и наблюдений.", ["M05"]),
        ("P03-mm-input", "unit_conversion", {"from": "um", "to": "mm", "exact_factor": "0.001"},
         "Точный десятичный перевод исходных мкм в мм; ожидаемые результаты снова в мкм.", ["P03"]),
    ]:
        cases.append(transform(rich, cid, kind, params, purpose, coverage))
    for d in ("up", "down"):
        for j in range(1, 6):
            cases.append(transform(
                rich, f"M06-{d}-repeat-{j}", "change_observation",
                {"position_id": "p00003", "direction": d, "repeat": j, "delta_um": "0.5"},
                "Один вход меняется на 0.5; его среднее обязано измениться ровно на 0.1.", ["M06"]))
    cases.append(transform(
        extreme, "M06-global-maximum", "change_observation",
        {"position_id": "p02", "direction": "up", "repeat": 5, "delta_um": "30"},
        "Глобальный максимум среднего переходит с p04 на p02/up.", ["M06"]))
    cases.append(transform(
        extreme, "M06-global-minimum", "change_observation",
        {"position_id": "p03", "direction": "down", "repeat": 1, "delta_um": "-30"},
        "Глобальный минимум среднего переходит с p01 на p03/down.", ["M06"]))

    def neg(cid, scenario, purpose, mutation, cls, why, arithmetic="not-permitted-for-selected-profile", level="input-error"):
        cases.append(invalid_case(zero, cid, [scenario], purpose, mutation, arithmetic, level, cls, why))
    neg("N01-missing-observation-value", "N01", "Отсутствует обязательное значение повторения.",
        lambda c: c["positions"][0]["up"][2].pop("value"),
        "Неполное обязательное наблюдение", "Номер повторения есть, числового значения нет; ноль не подставляется.")
    for suffix, value in (("empty-string", ""), ("blank-string", " "), ("malformed", "1,2abc")):
        neg("N02-" + suffix, "N02", "Недопустимая строка вместо полного десятичного числа.",
            lambda c, v=value: c["positions"][0]["up"][2].update(value=v),
            "Некорректный числовой ввод", "Пустые, пробельные и частично числовые строки не являются измерением.")
    neg("N03-four-repeats", "N03", "Четыре повторения.",
        lambda c: c["positions"][0]["up"].pop(),
        "Несоответствие числа повторений", "В выбранном профиле требуется ровно пять повторений каждого направления.")
    neg("N03-six-repeats", "N03", "Шесть повторений.",
        lambda c: c["positions"][0]["up"].append({"repeat": 6, "value": "0"}),
        "Несоответствие числа повторений", "Нельзя автоматически выбирать первые пять или отбрасывать шестое.")
    neg("N04-missing-direction", "N04", "Нет серии down.",
        lambda c: c["positions"][0].pop("down"),
        "Неоднозначная принадлежность направлению", "Нет полного набора двух явно именованных направлений.")
    neg("N04-ambiguous-direction", "N04", "Неподтверждённое имя reverse вместо down.",
        lambda c: c["positions"][0].update(reverse=c["positions"][0].pop("down")),
        "Неоднозначная принадлежность направлению", "Знак числа и порядок колонок не определяют направление подхода.")
    for suffix, value in (("unknown-unit", "counts"), ("ambiguous-unit", "mm/um")):
        neg("N05-" + suffix, "N05", "Единица не позволяет однозначную нормализацию.",
            lambda c, v=value: c["units"].update(deviation=v),
            "Неопределённая единица измерения", "Нельзя угадывать единицу по диапазону значений.")
    neg("N06-duplicate-position-id", "N06", "Повтор идентификатора позиции.",
        lambda c: c["positions"][1].update(position_id=c["positions"][0]["position_id"]),
        "Нарушена уникальность позиции или повторения", "Связь позиции с наблюдениями должна быть однозначной.")
    neg("N06-duplicate-repeat", "N06", "Повтор номера подхода.",
        lambda c: c["positions"][0]["up"][4].update(repeat=4),
        "Нарушена уникальность позиции или повторения", "Необходимы номера 1,2,3,4,5 без пропусков и дублей.")
    neg("N06-duplicate-coordinate", "N06", "Разные ID имеют одну заданную координату.",
        lambda c: c["positions"][1].update(target_mm=c["positions"][0]["target_mm"]),
        "Дубликат заданной координаты требует разбора плана", "Дубликат не объединяется и не считается новой заданной позицией молча.")
    neg("N07-no-positions", "N07", "Пустой набор позиций.",
        lambda c: c.update(positions=[]),
        "Осевая арифметика не определена", "При m=0 отсутствуют экстремумы и среднее Bi.",
        arithmetic="undefined", level="mathematical-error")
    neg("N07-four-positions", "N07", "Четыре полные позиции; арифметика возможна.",
        lambda c: c.update(positions=c["positions"][:4]),
        "Недостаточное число позиций для процедуры", "m=4 допускает анализ формул, но не подтверждает профиль испытания.",
        arithmetic="defined-for-preliminary-analysis", level="applicability-warning")
    for suffix, value in (("nan", "NaN"), ("infinity", "Infinity"), ("non-numeric", "abc"), ("boolean", True)):
        neg("N08-" + suffix, "N08", "Недопустимое числовое значение.",
            lambda c, v=value: c["positions"][0]["down"][1].update(value=v),
            "Некорректный числовой ввод", "Конечная десятичная числовая строка обязательна; bool не является измерением.")
    neg("N09-incomplete-report-metadata", "N09", "Числовой набор полный; сведений для отчёта нет.",
        lambda c: c["context"].update(report_metadata="missing", missing_report_fields=["test_date", "operator_name", "protocol_number"]),
        "Недостаточность сведений для полноценного отчёта", "Арифметика может выполняться, но дата испытания, исполнитель и номер протокола не указаны.",
        arithmetic="defined-for-preliminary-analysis", level="report-warning")
    neg("N10-outside-travel-profile", "N10", "Ход 2000.1 мм вне выбранного профиля.",
        lambda c: c["context"].update(full_travel_mm="2000.1"),
        "Известный выход за область выбранного профиля", "Формулы могут быть посчитаны, но профиль v1 ограничен полным ходом до 2000 мм включительно.",
        arithmetic="defined-for-preliminary-analysis", level="applicability-warning")
    return cases


def rounding_cases():
    rows = []
    for value in ("1.125", "1.375", "-1.125", "-1.375",
                  "1.225", "-1.225", "0.0005", "-0.0005",
                  "0.0015", "-0.0015", "0.0025", "-0.0025"):
        q = Decimal("0.001") if abs(Decimal(value)) < 1 else Decimal("0.01")
        with localcontext() as ctx:
            ctx.prec = 120
            exact_input = Decimal(value)
            represented = Decimal.from_float(float(value))  # Only the separate binary64 experiment.
            rows.append({
                "source_decimal": value, "quantum": str(q),
                "exact_decimal_expected": format(exact_input.quantize(q, rounding=ROUND_HALF_EVEN), "f"),
                "binary64_exact_decimal": str(represented),
                "binary64_hex": float(value).hex(),
                "exact_binary64_expected": format(represented.quantize(q, rounding=ROUND_HALF_EVEN), "f"),
            })
    return {
        "schema_version": SCHEMA, "case_id": "P04-rounding", "category": "formatting",
        "coverage": ["P04"], "unit": "um", "rule": "nearest-ties-to-even",
        "signed_zero": "may-be-displayed-as-zero-after-rounding",
        "approval": "proposed-not-metrologically-approved",
        "cases": rows,
    }


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def all_files():
    cases = build_cases()
    files = {}
    entries = []
    coverage = {}
    for c in cases:
        path = f"cases/{c['category']}/{c['case_id']}.json"
        content = encode(c)
        files[path] = content
        entries.append({
            "case_id": c["case_id"], "category": c["category"], "path": path,
            "positions": len(c["positions"]),
            "coverage": c["coverage"], "purpose_ru": c["purpose_ru"],
            "sha256": hashlib.sha256(content).hexdigest(),
        })
        for scenario in c["coverage"]:
            coverage.setdefault(scenario, []).append(c["case_id"])
    case_digest = hashlib.sha256("\n".join(entry["sha256"] for entry in entries).encode("ascii")).hexdigest()
    snapshot_status = "passed" if case_digest == VERIFIED_CASE_DIGEST else "requires-verification"
    for case, entry in zip(cases, entries):
        entry["sd_method"] = case["sd_method"]
        entry["expected_behavior"] = case["expected_validation"]["level"] if "expected_validation" in case else "numeric-results"
        entry["verification_status"] = snapshot_status
    files["rounding-cases.json"] = encode(rounding_cases())
    manifest = {
        "schema_version": SCHEMA,
        "package": "vsz-reference-fixtures-v1-03a",
        "date": "2026-11-19",
        "repository_basis": {"repository": "https://github.com/volkov43-beep/vsz-positioning-calculator", "commit": HEAD},
        "profile_id": PROFILE, "sd_method": METHOD,
        "method_status": "recommendation-awaiting-metrologist",
        "verification_evidence": {
            "verified_case_digest_sha256": VERIFIED_CASE_DIGEST,
            "positive_numeric_results": "checks/independent-results.json",
            "input_and_negative_results": "checks/validation-results.json",
        },
        "numeric_values": "decimal strings; expected lengths in um; variances in um2",
        "oracle": {"primary_working_decimal_digits": PRECISION, "output_significant_digits": OUTPUT_DIGITS,
                   "independent_verifier": "mpmath at 120 digits; pairwise variance; covering-interval Ri"},
        "counts": {
            "axis_case_files": len(cases),
            "valid": sum(c["category"] == "valid" for c in cases),
            "transformed": sum(c["category"] == "transformed" for c in cases),
            "invalid": sum(c["category"] == "invalid" for c in cases),
            "positive_with_all_outputs": sum("expected" in c for c in cases),
            "positive_positions": sum(len(c["positions"]) for c in cases if "expected" in c),
            "positive_observations": sum(10 * len(c["positions"]) for c in cases if "expected" in c),
            "expected_numeric_fields": sum(16 * len(c["positions"]) + 12 for c in cases if "expected" in c),
            "rounding_examples": len(rounding_cases()["cases"]),
        },
        "coverage": coverage,
        "supplements": [
            {"path": "rounding-cases.json", "coverage": ["P04"],
             "sha256": hashlib.sha256(files["rounding-cases.json"]).hexdigest()},
            {"path": "tools/numerical_stress.py", "coverage": ["P01", "P02", "P03", "P04", "P05"],
             "note": "Reproducible numerical experiments, including generated m=1000 and m=10000; not additional static axis fixtures."},
        ],
        "cases": entries,
        "public_data_origin": "All measurements independently synthesized by integer/decimal recipes. No factory or A.1 measurement array.",
    }
    files["manifest.json"] = encode(manifest)
    return files, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--check", action="store_true", help="Compare generated bytes to existing files, do not write.")
    args = parser.parse_args()
    files, manifest = all_files()
    mismatches = []
    for rel, content in files.items():
        destination = args.output / rel
        if args.check:
            if not destination.exists() or destination.read_bytes() != content:
                mismatches.append(rel)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    print(json.dumps({"status": "PASS" if not mismatches else "FAIL",
                      "mode": "check" if args.check else "generate",
                      "generated_files": len(files), "counts": manifest["counts"],
                      "mismatches": mismatches}, ensure_ascii=False, indent=2))
    if mismatches:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
