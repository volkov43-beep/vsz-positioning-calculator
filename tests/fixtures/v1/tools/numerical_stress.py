#!/usr/bin/env python3
"""Synthetic numerical experiments for iteration 03A; not a production calculator.

Standard-library only. Decimal source strings remain authoritative. Each experiment
uses exact Fraction input and variance, Decimal square roots (120 digits), a second
Decimal residual oracle (160 digits), and a separately written binary64 probe.
Run from any directory: python numerical_stress.py --output numerical-results.json
"""
from __future__ import annotations

import argparse
import copy
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import sys

PRECISION = 120
SECOND_PRECISION = 160
OUTPUT_DIGITS = 80
EPS = Decimal("2.220446049250313080847263336181640625e-16")
AXIS_FIELDS = ("A", "A_up", "A_down", "E", "E_up", "E_down", "M", "R", "R_up", "R_down", "B", "Bbar")
POSITION_FIELDS = ("mean_up", "mean_down", "mean_both", "s_up", "s_down", "lower_up", "upper_up", "lower_down", "upper_down", "B", "R_up", "R_down", "C", "R")
ABSOLUTE_FIELDS = ("mean_up", "mean_down", "mean_both", "lower_up", "upper_up", "lower_down", "upper_down")


def dec(q):
    if isinstance(q, Decimal):
        return q
    if isinstance(q, Fraction):
        return Decimal(q.numerator) / Decimal(q.denominator)
    if isinstance(q, float):
        return Decimal.from_float(q)
    return Decimal(q)


def text_number(x):
    with localcontext() as ctx:
        ctx.prec = OUTPUT_DIGITS
        v = +dec(x)
        return "0" if not v else str(v)


def convert_tree(obj):
    if isinstance(obj, (Decimal, Fraction)):
        return text_number(obj)
    if isinstance(obj, dict):
        return {k: convert_tree(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [convert_tree(v) for v in obj]
    return obj


def canonical_input_hash(rows):
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def fixed(num, places):
    """Exact finite decimal string from an integer; no float conversion."""
    sign = "-" if num < 0 else ""
    digits = str(abs(num)).zfill(places + 1)
    return sign + (digits[:-places] + "." + digits[-places:] if places else digits)


def generator(m):
    """0-based recipe agreed for T08 and P05. Coordinates in mm, x in um."""
    p, q = [-2, -1, 0, 1, 2], [-2, 0, 0, 0, 2]
    return [
        {"id": f"p{i+1:05d}", "target_mm": fixed(i, 1),
         "up": [fixed(100 * ((17*i) % 101 - 50) + (i % 7 + 1) * v, 3) for v in p],
         "down": [fixed(125 * ((29*i) % 97 - 48) + (i % 5 + 1) * v, 3) for v in q]}
        for i in range(m)
    ]


def small_signal(offset, scale):
    with localcontext() as ctx:
        ctx.prec = SECOND_PRECISION
        a, h = Decimal(offset), Decimal(scale)
        rows = []
        for i in range(5):
            rows.append({"id": f"p{i+1:05d}", "target_mm": str(250*i),
                         "up": [str(a + h*(3*i+j-16)) for j in range(5)],
                         "down": [str(a + h*(2*i+k-15)) for k in [-2, -1, 0, 2, 3]]})
        return rows


def mixed_scale():
    """The first series chooses a distant global origin; later tiny input is intact."""
    rows = small_signal("0", "0.000000000001")
    rows[0]["up"] = ["1000000"] * 5
    rows[0]["down"] = ["1000000"] * 5
    return rows


def aggregate(ps, mean_b=None):
    up = [p["mean_up"] for p in ps]
    dn = [p["mean_down"] for p in ps]
    both = [p["mean_both"] for p in ps]
    lu, uu = [p["lower_up"] for p in ps], [p["upper_up"] for p in ps]
    ld, ud = [p["lower_down"] for p in ps], [p["upper_down"] for p in ps]
    return {"A": max(uu+ud)-min(lu+ld), "A_up": max(uu)-min(lu), "A_down": max(ud)-min(ld),
            "E": max(up+dn)-min(up+dn), "E_up": max(up)-min(up), "E_down": max(dn)-min(dn),
            "M": max(both)-min(both), "R": max(p["R"] for p in ps),
            "R_up": max(p["R_up"] for p in ps), "R_down": max(p["R_down"] for p in ps),
            "B": max(abs(p["B"]) for p in ps),
            "Bbar": mean_b if mean_b is not None else sum(p["B"] for p in ps)/len(ps)}


def oracle(rows, binary_inputs=False):
    """Approach 1: exact rational means and pairwise variance identity."""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ps = []
        for row in rows:
            p = {}
            for direction in ("up", "down"):
                xs = [Fraction.from_float(float(v)) if binary_inputs else Fraction(v) for v in row[direction]]
                mu = sum(xs)/5
                var = sum((xs[j]-xs[k])**2 for j in range(5) for k in range(j+1, 5))/20
                s = dec(var).sqrt()
                p["mean_"+direction] = dec(mu)
                p["variance_"+direction] = dec(var)
                p["s_"+direction] = s
                p["lower_"+direction] = dec(mu)-2*s
                p["upper_"+direction] = dec(mu)+2*s
                p["R_"+direction] = 4*s
            p["mean_both"] = (p["mean_up"]+p["mean_down"])/2
            p["B"] = p["mean_up"]-p["mean_down"]
            p["C"] = 2*p["s_up"]+2*p["s_down"]+abs(p["B"])
            p["R"] = max(p["C"], p["R_up"], p["R_down"])
            ps.append(p)
        return {"positions": ps, "axis": aggregate(ps)}


def independent_oracle(rows, binary_inputs=False):
    """Approach 2: 160-digit Decimal residual variance and interval width."""
    with localcontext() as ctx:
        ctx.prec = SECOND_PRECISION
        ps = []
        for row in rows:
            p = {}
            for direction in ("up", "down"):
                xs = [Decimal.from_float(float(v)) if binary_inputs else Decimal(v) for v in row[direction]]
                mu = sum(xs)/Decimal(5)
                var = sum((v-mu)*(v-mu) for v in xs)/Decimal(4)
                s = var.sqrt()
                for field, value in (("mean", mu), ("variance", var), ("s", s), ("lower", mu-2*s), ("upper", mu+2*s), ("R", 4*s)):
                    p[field+"_"+direction] = value
            p["mean_both"] = sum(p["mean_"+d] for d in ("up", "down"))/Decimal(2)
            p["B"] = p["mean_up"]-p["mean_down"]
            p["C"] = 2*(p["s_up"]+p["s_down"])+abs(p["B"])
            p["R"] = max(p["upper_up"], p["upper_down"])-min(p["lower_up"], p["lower_down"])
            ps.append(p)
        # Independent global extrema collected as sorted endpoint lists.
        axis = {}
        for suffix, dirs in (("", ("up", "down")), ("_up", ("up",)), ("_down", ("down",))):
            lows = sorted(p["lower_"+d] for p in ps for d in dirs)
            highs = sorted(p["upper_"+d] for p in ps for d in dirs)
            mus = sorted(p["mean_"+d] for p in ps for d in dirs)
            axis["A"+suffix], axis["E"+suffix] = highs[-1]-lows[0], mus[-1]-mus[0]
            axis["R"+suffix] = sorted(p["R"+suffix] for p in ps)[-1]
        bm = sorted(p["mean_both"] for p in ps)
        axis.update(M=bm[-1]-bm[0], B=sorted(abs(p["B"]) for p in ps)[-1], Bbar=sum(p["B"] for p in ps)/Decimal(len(ps)))
        return {"positions": ps, "axis": axis}


def cross_check(a, b):
    count = 0
    worst = Decimal(0)
    with localcontext() as ctx:
        ctx.prec = SECOND_PRECISION
        pairs = [(f"axis.{k}", a["axis"][k], b["axis"][k]) for k in AXIS_FIELDS]
        pairs += [(f"positions.{i}.{k}", pa[k], pb[k]) for i, (pa, pb) in enumerate(zip(a["positions"], b["positions"])) for k in pa]
        for name, x, y in pairs:
            count += 1
            err = abs(x-y)
            scale = max(abs(x), abs(y))
            if not scale:
                assert err == 0, name
            else:
                rel = err/scale
                worst = max(worst, rel)
                assert rel <= Decimal("1e-95"), (name, str(x), str(y), str(rel))
    return {"compared_values": count, "max_relative_difference": worst, "relative_limit": "1e-95", "passed": True}


def compensated(values):
    s, c = 0.0, 0.0
    for a in values:
        t = s+a
        c += (s-t)+a if abs(s) >= abs(a) else (a-t)+s
        s = t
    return s+c


def float_series(xs):
    anchor = xs[0]
    ys = [v-anchor for v in xs]
    offset = compensated(ys)/5.0
    rs = [v-offset for v in ys]
    t = max(abs(v) for v in rs)
    s = 0.0 if t == 0.0 else t*math.sqrt(compensated([(v/t)**2 for v in rs])/4.0)
    return anchor, offset, s


def binary_probe(rows, local_first=False):
    """Probe of 02A order; local_first is an experimental partial correction."""
    raw = [{d: [float(v) for v in r[d]] for d in ("up", "down")} for r in rows]
    c0 = raw[0]["up"][0]
    ps, absolute_local = [], []
    for row in raw:
        p, local, abs_p = {}, {}, {}
        for d in ("up", "down"):
            if local_first:
                a, off, s = float_series(row[d])
                mu = compensated([a-c0, off])
                local[d] = (a, off)
                abs_mu = a+off
                abs_p["mean_"+d] = abs_mu
                abs_p["lower_"+d], abs_p["upper_"+d] = abs_mu-2*s, abs_mu+2*s
            else:
                a, off, s = float_series([x-c0 for x in row[d]])
                mu = a+off
            p["mean_"+d] = mu
            p["s_"+d] = s
            p["variance_"+d] = s*s
            p["lower_"+d], p["upper_"+d], p["R_"+d] = mu-2*s, mu+2*s, 4*s
        p["mean_both"] = (p["mean_up"]+p["mean_down"])/2
        if local_first:
            au, ou = local["up"]
            ad, od = local["down"]
            p["B"] = compensated([au-ad, ou, -od])
        else:
            p["B"] = p["mean_up"]-p["mean_down"]
        p["C"] = 2*p["s_up"]+2*p["s_down"]+abs(p["B"])
        p["R"] = max(p["C"], p["R_up"], p["R_down"])
        ps.append(p)
        if local_first:
            abs_p["mean_both"] = (abs_p["mean_up"]+abs_p["mean_down"])/2
            absolute_local.append({**p, **abs_p})
    ax = aggregate(ps, compensated([p["B"] for p in ps])/len(ps))
    absolute = absolute_local if local_first else [{k: (v+c0 if k in ABSOLUTE_FIELDS else v) for k, v in p.items()} for p in ps]
    return {"positions": absolute, "centered_positions": ps, "axis": ax, "c0": c0}


def proposed_limit(ref, scale):
    return 128*EPS*scale+Decimal("1e-12")*abs(ref)


def compare_probe(rows, exact, represented, probe):
    with localcontext() as ctx:
        ctx.prec = PRECISION
        source = [Fraction(v) for r in rows for d in ("up", "down") for v in r[d]]
        represented_inputs = [Fraction.from_float(float(v)) for r in rows for d in ("up", "down") for v in r[d]]
        c0 = Fraction.from_float(probe["c0"])
        S = max(abs(v) for v in source)
        Sc = max(abs(v-c0) for v in represented_inputs)
        local_series_scales = []
        position_scales = []
        for row in rows:
            local_series_scales.append({d: max(abs(Fraction.from_float(float(v))-Fraction.from_float(float(row[d][0]))) for v in row[d]) for d in ("up", "down")})
            allv = [Fraction.from_float(float(v)) for d in ("up", "down") for v in row[d]]
            position_scales.append(max(allv)-min(allv))
        errors = {"decimal_axis_max_abs_error": Decimal(0), "algorithm_axis_max_abs_error": Decimal(0), "algorithm_stable_position_max_abs_error": Decimal(0), "absolute_position_max_abs_error": Decimal(0)}
        global_failures, centered_failures, local_failures = [], [], []
        local_failure_details = []
        def fail_local(name, val, ref, scale, limit):
            local_failures.append(name)
            local_failure_details.append({"field": name, "reference": ref, "actual_exact_binary64": str(val),
                                          "absolute_error": abs(val-ref), "scale_um": dec(scale), "limit": limit})
        axis_errors = {}
        for k in AXIS_FIELDS:
            val = Decimal.from_float(probe["axis"][k])
            err_dec = abs(val-exact["axis"][k])
            err_bin = abs(val-represented["axis"][k])
            errors["decimal_axis_max_abs_error"] = max(errors["decimal_axis_max_abs_error"], err_dec)
            errors["algorithm_axis_max_abs_error"] = max(errors["algorithm_axis_max_abs_error"], err_bin)
            axis_errors[k] = {"decimal_reference": exact["axis"][k], "binary_input_reference": represented["axis"][k], "binary64_result_exact": str(val), "input_quantization_effect": abs(represented["axis"][k]-exact["axis"][k]), "algorithm_abs_error": err_bin}
            old_limit = 128*EPS*dec(S)+Decimal("1e-12")*max(abs(val), abs(exact["axis"][k]))
            center_limit = 128*EPS*dec(Sc)+Decimal("1e-12")*max(abs(val), abs(represented["axis"][k]))
            if err_dec > old_limit:
                global_failures.append("axis."+k)
            if err_bin > center_limit:
                centered_failures.append("axis."+k)
            if k in ("R", "R_up", "R_down", "B", "Bbar"):
                scale = max(position_scales)
                if k in ("R_up", "R_down"):
                    d = k[2:]
                    scale = 4*max(x[d] for x in local_series_scales)
                limit = proposed_limit(represented["axis"][k], dec(scale))
                if err_bin > limit:
                    fail_local("axis."+k, val, represented["axis"][k], scale, limit)
        field_comparisons = 12
        for i, (act, ref) in enumerate(zip(probe["positions"], represented["positions"])):
            for k in POSITION_FIELDS:
                field_comparisons += 1
                val, rv = Decimal.from_float(act[k]), ref[k]
                err = abs(val-rv)
                if k in ABSOLUTE_FIELDS:
                    errors["absolute_position_max_abs_error"] = max(errors["absolute_position_max_abs_error"], err)
                    cref = rv-dec(c0)
                    cactual = Decimal.from_float(probe["centered_positions"][i][k])
                    center_err = abs(cactual-cref)
                    center_limit = 128*EPS*dec(Sc)+Decimal("1e-12")*max(abs(cactual), abs(cref))
                    if center_err > center_limit:
                        centered_failures.append(f"positions.{i}.{k}.centered")
                    near = float(rv)
                    ulp = max(abs(math.nextafter(near, math.inf)-near), abs(near-math.nextafter(near, -math.inf)))
                    if err > center_limit+Decimal.from_float(ulp):
                        centered_failures.append(f"positions.{i}.{k}.absolute")
                    # Absolute local outputs must also be checked around a local
                    # input anchor; the remote global-origin budget can hide loss.
                    d = "down" if k.endswith("_down") else "up"
                    local_anchor = Fraction.from_float(float(rows[i][d][0]))
                    local_ref = rv-dec(local_anchor)
                    local_scale = position_scales[i] if k == "mean_both" else local_series_scales[i][d]
                    limit = proposed_limit(local_ref, dec(local_scale))+Decimal.from_float(ulp)
                    if (k == "mean_both" and position_scales[i] == 0) or (k != "mean_both" and local_series_scales[i][d] == 0):
                        # A constant binary64 series must reproduce its value
                        # exactly; no ULP allowance can conceal a changed constant.
                        limit = Decimal(0)
                    if err > limit:
                        fail_local(f"positions.{i}.{k}.absolute_local", val, rv, local_scale, limit)
                else:
                    errors["algorithm_stable_position_max_abs_error"] = max(errors["algorithm_stable_position_max_abs_error"], err)
                    center_limit = 128*EPS*dec(Sc)+Decimal("1e-12")*max(abs(val), abs(rv))
                    if err > center_limit:
                        centered_failures.append(f"positions.{i}.{k}")
                    scale = position_scales[i]
                    if k in ("s_up", "s_down", "R_up", "R_down"):
                        d = "up" if k.endswith("_up") else "down"
                        scale = local_series_scales[i][d]*(4 if k.startswith("R_") else 1)
                    limit = proposed_limit(rv, dec(scale))
                    if err > limit:
                        fail_local(f"positions.{i}.{k}", val, rv, scale, limit)
        collisions = []
        for i, row in enumerate(rows):
            for d in ("up", "down"):
                udec, ubin = len(set(Fraction(v) for v in row[d])), len(set(float(v) for v in row[d]))
                if udec != ubin:
                    collisions.append({"position": row["id"], "direction": d, "distinct_decimal": udec, "distinct_binary64": ubin})
        return {"field_comparisons": field_comparisons,
                "constant_series_exactness_enforced": True,
                "max_input_quantization_abs_um": max(dec(abs(a-b)) for a, b in zip(source, represented_inputs)),
                "S_um": dec(S), "Sc_um": dec(Sc), "errors_um": errors,
                "old_global_tolerance_failures": global_failures,
                "old_centered_tolerance_failures": centered_failures,
                "proposed_local_tolerance_failures": local_failures,
                "proposed_local_tolerance_failure_details": local_failure_details,
                "distinct_input_collisions": collisions,
                "axis": axis_errors}


def analyze_case(case_id, rows, purpose, include_input=False, export_path=None):
    exact, represented = oracle(rows), oracle(rows, True)
    cross_decimal = cross_check(exact, independent_oracle(rows))
    cross_binary = cross_check(represented, independent_oracle(rows, True))
    baseline = binary_probe(rows)
    corrected = binary_probe(rows, True)
    result = {"id": case_id, "purpose": purpose, "m": len(rows), "observations": len(rows)*10,
              "input_sha256": canonical_input_hash(rows), "method": "sample-n-minus-1",
              "units": {"deviation": "um", "target": "mm", "variance": "um^2"},
              "independent_oracles": {"decimal_inputs": cross_decimal, "exact_binary64_inputs": cross_binary},
              "input_perturbation_budget_check": check_input_budget(rows, exact, represented),
              "probe_02a_global_first": compare_probe(rows, exact, represented, baseline),
              "probe_local_first_experimental": compare_probe(rows, exact, represented, corrected)}
    xs = [float(v) for v in rows[0]["up"]]
    naive_var = (sum(x*x for x in xs)-sum(xs)**2/5.0)/4.0
    result["first_up_series"] = {"decimal_s": exact["positions"][0]["s_up"], "binary_reference_s": represented["positions"][0]["s_up"],
                                 "global_first_s": Decimal.from_float(baseline["positions"][0]["s_up"]),
                                 "naive_variance_binary64_exact": str(Decimal.from_float(naive_var)),
                                 "naive_variance_sign": "negative" if naive_var < 0 else "zero" if naive_var == 0 else "positive"}
    if case_id == "EXP-P02-mixed-scale":
        i = 1
        result["critical_position"] = {"id": rows[i]["id"], "original_binary64_values_are_distinct": len(set(float(x) for x in rows[i]["up"])) == 5,
                                       "after_global_center_distinct_count": len(set(float(x)-baseline["c0"] for x in rows[i]["up"])),
                                       "reference": {k: represented["positions"][i][k] for k in ("s_up", "s_down", "B", "R")},
                                       "global_first": {k: Decimal.from_float(baseline["positions"][i][k]) for k in ("s_up", "s_down", "B", "R")},
                                       "local_first": {k: Decimal.from_float(corrected["positions"][i][k]) for k in ("s_up", "s_down", "B", "R")}}
    if include_input:
        result["source_positions"] = rows
    if export_path is not None:
        export = {"schema_version": "numerical-generated-reference-1", "experiment_id": case_id,
                  "method": "sample-n-minus-1", "units": {"target": "mm", "deviation": "um", "variance": "um^2"},
                  "source_positions": rows, "source_input_sha256": canonical_input_hash(rows),
                  "expected_decimal_inputs": exact, "expected_exact_binary64_inputs": represented,
                  "position_matching": "Expected positions are in exactly the same order as source_positions; the source contains unique identities.",
                  "working_digits": PRECISION, "stored_significant_digits": OUTPUT_DIGITS,
                  "independent_cross_check": result["independent_oracles"]}
        export_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(convert_tree(export), ensure_ascii=False, indent=2, allow_nan=False)+"\n"
        export_path.write_text(payload, encoding="utf-8")
        assert json.loads(export_path.read_text(encoding="utf-8")) == convert_tree(export)
        result["optional_export"] = {"filename": export_path.name, "sha256": hashlib.sha256(payload.encode()).hexdigest()}
    return result


def check_input_budget(rows, exact, represented):
    """Verify observed input-quantization effects against analytical Lipschitz budgets."""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        delta = max(dec(abs(Fraction(v)-Fraction.from_float(float(v)))) for r in rows for d in ("up", "down") for v in r[d])
        alpha = (Decimal(5)/4).sqrt()
        coefficients = {"A": 2+4*alpha, "A_up": 2+4*alpha, "A_down": 2+4*alpha,
                        "E": 2, "E_up": 2, "E_down": 2, "M": 2, "B": 2, "Bbar": 2,
                        "R": 2+4*alpha, "R_up": 4*alpha, "R_down": 4*alpha}
        checked, worst_ratio = 0, Decimal(0)
        for key in AXIS_FIELDS:
            actual_change = abs(exact["axis"][key]-represented["axis"][key])
            budget = coefficients[key]*delta
            assert actual_change <= budget, (key, actual_change, budget)
            checked += 1
            worst_ratio = max(worst_ratio, actual_change/budget if budget else Decimal(0))
        return {"axis_values_checked": checked, "passed": True, "delta_um": delta,
                "largest_observed_fraction_of_axis_budget": worst_ratio,
                "basis": "For max input perturbation delta: mean<=delta; s<=sqrt(5/4)*delta; E/M/B/Bbar<=2delta; A/R<=(2+4sqrt(5/4))*delta. This does not budget algorithm rounding."}


def units_experiment():
    examples = ["0.000009", "-0.000009", "0.00000123456789", "0.001001", "0.001003", "0.123456789123456789", "999.999999999999999"]
    rows = []
    with localcontext() as ctx:
        ctx.prec = PRECISION
        for src in examples:
            exact_um = Decimal(src)*1000
            normalized = float(str(exact_um))
            two_operations = float(src)*1000.0
            rows.append({"source_mm": src, "normalized_um_exact": exact_um,
                         "one_parse_um_exact_binary64": str(Decimal.from_float(normalized)),
                         "parse_then_multiply_um_exact_binary64": str(Decimal.from_float(two_operations)),
                         "one_parse_abs_error_um": abs(Decimal.from_float(normalized)-exact_um),
                         "parse_then_multiply_abs_error_um": abs(Decimal.from_float(two_operations)-exact_um),
                         "different_binary64": normalized != two_operations,
                         "exact_round_trip_mm": exact_um/1000})
        # Entire physical dataset, compared from exact mm strings and exact um strings.
        um = generator(12)
        mm = copy.deepcopy(um)
        for r in mm:
            for d in ("up", "down"):
                r[d] = [str(Decimal(v)/1000) for v in r[d]]
        restored = copy.deepcopy(mm)
        for r in restored:
            for d in ("up", "down"):
                r[d] = [str(Decimal(v)*1000) for v in r[d]]
        ref = oracle(um)
        ref_restored = oracle(restored)
        assert ref == ref_restored
        assert all(Fraction(a) == Fraction(b) for ru, rr in zip(um, restored) for d in ("up", "down") for a, b in zip(ru[d], rr[d]))
        return {"id": "EXP-P03-units", "examples": rows, "dataset_m": 12, "all_120_observations_exactly_restored": True,
                "all_intermediates_and_12_axis_values_exactly_equal": True, "decimal_source_inputs_preserved": True,
                "axis_um": ref["axis"]}


def rounding_experiment():
    values = ["1.125", "1.375", "-1.125", "-1.375", "1.225", "-1.225", "0.005", "-0.005", "2.675", "-2.675"]
    result = []
    def rational_half_even(value, quantum):
        scaled = value/quantum
        integral, remainder = divmod(abs(scaled.numerator), scaled.denominator)
        if 2*remainder > scaled.denominator or (2*remainder == scaled.denominator and integral % 2):
            integral += 1
        return (-integral if scaled < 0 else integral)*quantum
    with localcontext() as ctx:
        ctx.prec = PRECISION
        q = Decimal("0.01")
        for src in values:
            d, b = Decimal(src), Decimal.from_float(float(src))
            rd, rb = d.quantize(q, rounding=ROUND_HALF_EVEN), b.quantize(q, rounding=ROUND_HALF_EVEN)
            assert Fraction(rd) == rational_half_even(Fraction(src), Fraction(1, 100))
            assert Fraction(rb) == rational_half_even(Fraction.from_float(float(src)), Fraction(1, 100))
            result.append({"source_decimal": src, "quantum": "0.01", "decimal_input_half_even": format(rd, ".2f"),
                           "exact_binary64_input": str(b), "binary64_input_half_even": format(rb, ".2f"),
                           "decimal_is_exact_halfway": abs(d/q-(d/q).to_integral_value(rounding=ROUND_HALF_EVEN)) == Decimal("0.5"),
                           "binary_is_exact_halfway": abs(b/q-(b/q).to_integral_value(rounding=ROUND_HALF_EVEN)) == Decimal("0.5")})
        return {"id": "EXP-P04-rounding", "mode": "nearest-ties-to-even", "examples": result, "tested_examples": len(result),
                "independent_integer_division_checks": len(result)*2,
                "statement": "The rounded mathematical decimal source and the rounded exact binary64 are different contracts; no shortened decimal repr is used for binary64 rounding."}


def check_fixture_suite(root):
    """Independently load and verify the delivered positive JSON, without importing its generator."""
    manifest = json.loads((root/"manifest.json").read_text(encoding="utf-8"))
    entries = [v for v in manifest["cases"] if v["category"] in ("valid", "transformed")]
    aliases = {"s_up": "sd_up", "s_down": "sd_down", "B": "B_i", "R_up": "R_i_up", "R_down": "R_i_down", "C": "C_i", "R": "R_i"}
    cases, numeric_count, pos_count, independent_count = [], 0, 0, 0
    binary_count = 0
    with localcontext() as ctx:
        ctx.prec = PRECISION
        for entry in entries:
            payload = (root/entry["path"]).read_bytes()
            case = json.loads(payload)
            assert case["sd_method"] == "sample-n-minus-1"
            factor = Fraction(1000) if case["units"]["deviation"] == "mm" else Fraction(1)
            assert case["units"]["deviation"] in ("mm", "um")
            rows = [{"id": p["position_id"], "target_mm": p["target_mm"],
                     **{d: [str(dec(Fraction(o["value"])*factor)) for o in p[d]] for d in ("up", "down")}}
                    for p in case["positions"]]
            decimal_ref, binary_ref = oracle(rows), oracle(rows, True)
            ca = cross_check(decimal_ref, independent_oracle(rows))
            cb = cross_check(binary_ref, independent_oracle(rows, True))
            independent_count += ca["compared_values"]+cb["compared_values"]
            per_case_numeric = 0
            pairs = [("axis."+k, Decimal(case["expected"]["axis"][k]), decimal_ref["axis"][k]) for k in AXIS_FIELDS]
            for i, (saved, computed) in enumerate(zip(case["expected"]["positions"], decimal_ref["positions"])):
                assert saved["position_id"] == rows[i]["id"]
                pairs += [(f"positions.{i}.{k}", Decimal(saved[aliases.get(k, k)]), computed[k]) for k in computed]
            assert len(case["expected"]["positions"]) == len(rows)
            for name, saved, computed in pairs:
                per_case_numeric += 1
                if computed == 0:
                    assert saved == 0, (case["case_id"], name, saved, computed)
                else:
                    assert abs(saved-computed) <= Decimal("1e-68")*abs(computed), (case["case_id"], name, saved, computed)
            numeric_count += per_case_numeric
            pos_count += len(rows)
            item = {"case_id": case["case_id"], "path": entry["path"], "sha256": hashlib.sha256(payload).hexdigest(),
                    "positions": len(rows), "serialized_expected_values_checked": per_case_numeric,
                    "serialized_expectations_match_independent_oracle": True, "input_units": case["units"]["deviation"]}
            for label, local in (("probe_02a_global_first", False), ("probe_local_first_experimental", True)):
                comparison = compare_probe(rows, decimal_ref, binary_ref, binary_probe(rows, local))
                binary_count += comparison["field_comparisons"]
                compact = {k: v for k, v in comparison.items() if k != "axis"}
                compact["axis_algorithm_absolute_errors_um"] = {k: comparison["axis"][k]["algorithm_abs_error"] for k in AXIS_FIELDS}
                item[label] = compact
            cases.append(item)
        return {"fixture_schema": manifest["schema_version"], "case_count": len(cases), "position_count": pos_count,
                "observation_count": 10*pos_count, "serialized_numeric_values_checked": numeric_count,
                "independent_oracle_comparisons": independent_count, "binary64_probe_field_comparisons": binary_count,
                "all_serialized_values_match_independent_oracle": True,
                "all_local_first_probes_pass_local_criteria": all(not e["probe_local_first_experimental"]["proposed_local_tolerance_failures"] for e in cases),
                "cases": cases}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]/"checks"/"numerical-results.json")
    ap.add_argument("--sizes", default="5,12,1000,10000")
    ap.add_argument("--fixtures-root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--export-generated", type=Path, default=None,
                    help="Optional destination for full P05 source and both oracle outputs; may create large JSON files.")
    args = ap.parse_args()
    assert sys.float_info.radix == 2 and sys.float_info.mant_dig == 53 and sys.float_info.max_exp == 1024
    sizes = [int(v) for v in args.sizes.split(",")]
    if any(m < 5 or m > 10000 for m in sizes):
        ap.error("This helper's tested generator scope is 5 <= m <= 10000; this is a computational test restriction, not a standard requirement.")
    experiments = []
    experiments.append(analyze_case("EXP-P01-small-scatter", small_signal("0", "0.000000000001"), "Nonzero 1e-12 um scale at a small origin.", True))
    for label, h in (("1e-6", "0.000001"), ("1e-10", "0.0000000001"), ("1e-12", "0.000000000001")):
        experiments.append(analyze_case("EXP-P02-offset-"+label, small_signal("1000000", h), "Common 1e6 um offset; source quantization and arithmetic separated.", True))
    experiments.append(analyze_case("EXP-P02-mixed-scale", mixed_scale(), "Counterexample: global pre-centering erases intact local information.", True))
    for m in sizes:
        export_path = args.export_generated/f"EXP-P05-m{m}.json" if args.export_generated else None
        experiments.append(analyze_case(f"EXP-P05-m{m}", generator(m), "Deterministic modular integer/1000 recipe, independently implemented.", export_path=export_path))
    result = {"schema_version": "numerical-experiments-1", "profile": "linear-axis-le-2000mm-n5-v1", "method": "sample-n-minus-1",
              "scope": "Synthetic numerical experiments; not a production implementation and not metrological approval.",
              "working_precision_digits": PRECISION, "independent_precision_digits": SECOND_PRECISION, "stored_significant_digits": OUTPUT_DIGITS,
              "exact_binary64_scalar_diagnostics": "Scalar fields explicitly labeled exact binary64 retain full exact decimal expansions; irrational references and error summaries use the stated output precision.",
              "runtime": {"language": "Python", "version": sys.version.split()[0], "binary_significand_bits": sys.float_info.mant_dig,
                          "binary_radix": sys.float_info.radix, "binary_max_exponent": sys.float_info.max_exp},
              "source_inputs": "Exact decimal strings; exact binary64 input values recovered with Fraction.from_float / Decimal.from_float only for the second error layer.",
              "generator": {"id": "modular-integers-v1", "i": "0-based", "target_mm": "i/10", "full_travel_mm": "1000", "position_id": "p + 1-based index padded to 5 digits",
                            "p": [-2, -1, 0, 1, 2], "q": [-2, 0, 0, 0, 2],
                            "up_um": "(100*((17*i)%101-50)+(i%7+1)*p[j])/1000",
                            "down_um": "(125*((29*i)%97-48)+(i%5+1)*q[j])/1000"},
              "experiments": experiments, "unit_normalization": units_experiment(), "rounding": rounding_experiment(),
              "fixture_suite": check_fixture_suite(args.fixtures_root),
              "verification": {"experiment_count": len(experiments), "total_position_instances": sum(e["m"] for e in experiments),
                               "oracle_numeric_comparisons": sum(e["independent_oracles"][layer]["compared_values"] for e in experiments for layer in ("decimal_inputs", "exact_binary64_inputs")),
                               "all_independent_oracle_checks_passed": True,
                               "no_universal_binary64_error_bound_claimed": True}}
    serialized = convert_tree(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(serialized, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    args.output.write_text(payload, encoding="utf-8")
    reread = json.loads(args.output.read_text(encoding="utf-8"))
    assert reread == serialized
    print(json.dumps({"output": str(args.output), "sha256": hashlib.sha256(payload.encode()).hexdigest(), "verification": serialized["verification"],
                      "experiments": [{"id": e["id"], "global_first_local_failures": len(e["probe_02a_global_first"]["proposed_local_tolerance_failures"]),
                                       "local_first_local_failures": len(e["probe_local_first_experimental"]["proposed_local_tolerance_failures"]),
                                       "algorithm_max_abs_axis_error": e["probe_02a_global_first"]["errors_um"]["algorithm_axis_max_abs_error"]} for e in serialized["experiments"]]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
