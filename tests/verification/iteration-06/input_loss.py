"""Exact input conversion and per-field representation bounds for the synthetic 06 checks."""

from decimal import Decimal
from fractions import Fraction as Q
import math
import re

from verify_reference import DIRECTIONS, Value, ZERO, axis_reference, certify, exact_position, select
from rounding import bits

NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
UNIT_SHIFT = {"um": 0, "mm": 3}


def conversion(raw, unit):
    trace = {"raw": raw, "unit": unit}
    if unit not in UNIT_SHIFT:
        return {**trace, "reason": "unit-unknown", "input_code": "UNIT_UNKNOWN"}
    if not isinstance(raw, str):
        return {**trace, "reason": "syntax-invalid", "input_code": "OBS_TYPE"}
    text = raw.strip().replace("−", "-").replace(",", ".")
    if not NUMBER.fullmatch(text):
        special = {"nan": "OBS_NAN", "inf": "OBS_INFINITY", "infinity": "OBS_INFINITY"}
        if not raw:
            code = "OBS_EMPTY"
        elif not text:
            code = "OBS_WHITESPACE"
        else:
            code = special.get(text.lower().lstrip("+-"), "OBS_TEXT" if text.isalpha() else "OBS_MALFORMED")
        return {**trace, "reason": "syntax-invalid", "input_code": code}
    source = Decimal(text)
    sign, digits, exponent = source.as_tuple()
    scaled = Decimal((sign, digits, exponent + UNIT_SHIFT[unit]))
    normalized = format(scaled, "f")
    if "." in normalized:
        normalized = normalized.rstrip("0").rstrip(".")
    if not scaled:
        normalized = "0"
    d = Q(scaled)
    trace.update(exact_decimal=Q(source), normalized_um=normalized, d=d)
    try:
        actual = float(d)
    except OverflowError:
        actual = -math.inf if d < 0 else math.inf
    proof = certify(Value(d), actual)
    trace.update(binary64=actual.hex(), bits=bits(actual), certificate=proof["status"], b=None, error=None)
    if proof["status"] != "certified":
        return {**trace, "reason": "input-rounding-uncertified"}
    if not math.isfinite(actual):
        return {**trace, "reason": "input-nonfinite"}
    b = Q.from_float(actual)
    trace.update(b=b, error=b-d)
    if d and not b:
        trace["reason"] = "input-nonzero-to-zero"
    return trace


def find_collisions(observations):
    """One witness per distinct decimal after the first in each binary equivalence class."""
    groups, witnesses = {}, []
    for obs in observations:
        if obs.get("b") is None or obs.get("reason"):
            continue
        group = groups.setdefault(obs["b"], {})
        if obs["d"] in group:
            continue
        if group:
            first = next(iter(group.values()))
            witnesses.append({"first": first["address"], "second": obs["address"],
                              "first_d": first["d"], "second_d": obs["d"], "b": obs["b"]})
        group[obs["d"]] = obs
    return witnesses


def valid_collisions(observations, witnesses):
    """Check independent counts and witness bindings against distinct decimal preimages."""
    # Address dictionaries may arrive in a different key order after JSON round-trips.
    def address_key(a):
        return (a["positionId"], a["direction"], a["repeat"])

    addressed = {address_key(o["address"]): o for o in observations}
    if len(addressed) != len(observations):
        return False
    classes, first_for_b = {}, {}
    for o in observations:
        if o.get("b") is not None and not o.get("reason"):
            classes.setdefault(o["b"], set()).add(o["d"])
            first_for_b.setdefault(o["b"], o["address"])
    seen = {}
    for witness in witnesses:
        first = addressed.get(address_key(witness["first"]))
        second = addressed.get(address_key(witness["second"]))
        if first is None or second is None or first.get("reason") or second.get("reason"):
            return False
        if not (first["b"] == second["b"] == witness["b"] and first["d"] == witness["first_d"]
                and second["d"] == witness["second_d"] and first["d"] != second["d"]):
            return False
        if first["address"] != first_for_b[first["b"]]:
            return False
        seen.setdefault(first["b"], set()).update([first["d"], second["d"]])
    needed = {b: ds for b, ds in classes.items() if len(ds) > 1}
    return seen == needed and len(witnesses) == sum(len(ds)-1 for ds in needed.values())


def absolute(x):
    return x.scaled(-1) if x.compare(ZERO) < 0 else x


def extremum(values, largest=True):
    return select(enumerate(values), largest)[0]


def spread(values):
    return extremum(values) - extremum(values, False)


def position_bounds(errors, b_fields):
    bound, series = {}, {}
    for direction in DIRECTIONS:
        e = errors[direction]
        a = sum(e) / 5
        beta2 = sum((x-a)**2 for x in e) / 4
        beta = Value(terms=((1, beta2),))
        v_b = b_fields["variance_" + direction].rational
        width = beta.scaled(2)
        band_bound = Value(abs(a)) + width
        # sqrt(v_b)*sqrt(beta2) = sqrt(v_b*beta2) for the nonnegative roots.
        variance_bound = Value(beta2, ((2, v_b * beta2),))
        bounds = {"mean": Value(abs(a)), "sd": beta, "twoSd": width, "R_i": beta.scaled(4),
                  "lower": band_bound, "upper": band_bound, "range": Value(max(e)-min(e)),
                  "variance": variance_bound}
        bound.update({key+"_"+direction: value for key, value in bounds.items()})
        series[direction] = {"a": a, "beta": beta, "beta2": beta2}
    up, down = (series[k] for k in DIRECTIONS)
    bound["mean_both"] = Value(abs((up["a"]+down["a"])/2))
    bound["B_i"] = Value(abs(up["a"]-down["a"]))
    bound["C_i"] = bound["B_i"] + (up["beta"] + down["beta"]).scaled(2)
    bound["R_i"] = extremum([bound[k] for k in ("C_i", "R_i_up", "R_i_down")])
    return bound, series


def axis_bounds(series, local):
    bounds = {}
    for suffix, directions in (("", DIRECTIONS), ("_up", ("up",)), ("_down", ("down",))):
        group = [row[d] for row in series.values() for d in directions]
        upper = [Value(s["a"]) + s["beta"].scaled(2) for s in group]
        lower = [Value(s["a"]) - s["beta"].scaled(2) for s in group]
        bounds["A"+suffix] = extremum(upper) - extremum(lower, False)
        bounds["E"+suffix] = spread([Value(s["a"]) for s in group])
        bounds["R"+suffix] = extremum([p["R_i"+suffix] for p in local.values()])
    differences = [p["up"]["a"] - p["down"]["a"] for p in series.values()]
    bounds["B"] = Value(max(map(abs, differences)))
    bounds["Bbar"] = Value(abs(sum(differences)/len(series)))
    bounds["M"] = spread([Value((p["up"]["a"]+p["down"]["a"])/2) for p in series.values()])
    return bounds


def measure(rows, unit):
    observations, decimal, binary, bounds, stats = [], {}, {}, {}, {}
    for row in rows:
        pid = row["id"]
        layers = {key: {} for key in ("d", "b", "error")}
        for direction in DIRECTIONS:
            converted = []
            for repeat, raw in enumerate(row[direction], 1):
                trace = conversion(raw, unit)
                trace["address"] = {"positionId": pid, "direction": direction, "repeat": repeat}
                if trace.get("reason"):
                    raise ValueError(trace)
                observations.append(trace)
                converted.append(trace)
            for key, series in layers.items():
                series[direction] = [o[key] for o in converted]
        decimal[pid], _ = exact_position(layers["d"])
        binary[pid], _ = exact_position(layers["b"])
        bounds[pid], stats[pid] = position_bounds(layers["error"], binary[pid])
        for d in DIRECTIONS:
            if binary[pid]["mean_"+d].rational - decimal[pid]["mean_"+d].rational != stats[pid][d]["a"]:
                raise AssertionError("Signed mean error")
        if (binary[pid]["B_i"].rational - decimal[pid]["B_i"].rational
                != stats[pid]["up"]["a"] - stats[pid]["down"]["a"]):
            raise AssertionError("Signed reversal error")
    axis_d, _ = axis_reference(decimal)
    axis_b, extrema_b = axis_reference(binary)
    decimal["axis"], binary["axis"] = axis_d, axis_b
    bounds["axis"] = axis_bounds(stats, bounds)
    signed_bbar = sum(p["up"]["a"] - p["down"]["a"] for p in stats.values()) / len(stats)
    if axis_b["Bbar"].rational - axis_d["Bbar"].rational != signed_bbar:
        raise AssertionError("Signed axis mean reversal error")

    fields = {}
    for pid, group in decimal.items():
        if group.keys() != bounds[pid].keys() or group.keys() != binary[pid].keys():
            raise AssertionError("Incomplete budget family coverage")
        fields[pid] = {}
        for key, yd in group.items():
            yb, limit = binary[pid][key], bounds[pid][key]
            impact = absolute(yb - yd)
            relation = impact.compare(limit)
            if relation > 0:
                raise AssertionError(f"{pid}/{key}: actual representation error exceeds analytical bound")
            fields[pid][key] = {"d": yd, "b": yb, "Q": limit, "impact": impact,
                                "impact_vs_Q": relation, "unit": "um2" if key.startswith("variance_") else "um"}
    collisions = find_collisions(observations)
    if not valid_collisions(observations, collisions):
        raise AssertionError("Incomplete or spurious collision evidence")
    return {"snapshot": {"unit": unit, "rows": rows}, "observations": observations, "collisions": collisions,
            "series": stats, "fields": fields, "extrema_b": extrema_b}


def budget(field, absolute_budget=None, relative_budget=None, unit=None, *, direct=True):
    """Classify a supplied test profile. No production budget is supplied by default."""
    if absolute_budget is None or relative_budget is None:
        return "budget-not-approved"
    if (unit != field["unit"] or any(type(x) not in (int, Q) for x in (absolute_budget, relative_budget))
            or min(absolute_budget, relative_budget) < 0):
        raise ValueError("Budget dimension or sign")
    allowance = Value(absolute_budget)
    rho = relative_budget
    lhs = field["Q"].scaled(1+rho)
    try:
        rhs = allowance + absolute(field["b"]).scaled(rho)
        if lhs.compare(rhs) <= 0:
            return "budget-certified"
    except ArithmeticError:
        pass  # An independent direct comparison may still decide this case.
    if direct:
        try:
            relation = field["impact"].compare(allowance + absolute(field["d"]).scaled(rho))
            return "budget-exceeded" if relation > 0 else "budget-certified"
        except ArithmeticError:
            return "budget-uncertified"
    return "budget-uncertified"
