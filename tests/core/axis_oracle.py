"""Independent positional and axis witnesses from verification 06. Never imported by the TS core."""
from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/verification/iteration-06"))
from verify_reference import DIRECTIONS, ZERO, axis_reference, certify, exact_position, position_reference, v1
from observations import observe
from verify_input_loss import fixtures, paired, witnesses
from verify_scale import from_rows
from numerical_stress import generator
from validation_check import classify_inputs


def synthetic(name, rows):
    case = from_rows(name, rows)
    case.update(schema_version="vsz-fixtures-1.0", profile_id=v1.PROFILE, sd_method="sample-n-minus-1",
                context={"full_travel_mm": "1000"})
    case["units"]["coordinate"] = "mm"
    return case


def certified_fields(exact, observed, count):
    if exact.keys() != observed.keys() or len(exact) != count:
        raise ValueError("Incomplete field inventory")
    result = {}
    for key, expr in exact.items():
        proof = certify(expr, observed[key])
        if proof["status"] != "certified":
            raise ArithmeticError((key, proof))
        result[key] = proof["bits"]
    return result


def record(case):
    if case.get("category") == "invalid":
        primary = classify_inputs(case)["primary"]["level"]
        assert primary == case["expected_validation"]["level"]
        return {"fixture": case, "level": primary}

    # Form expectations over b before consulting any decimal expected fields.
    observed, observed_axis, branches, extrema = observe(case)
    factor = {"um": 1, "mm": 1000}[case["units"]["deviation"]]
    exact_b, exact_d, positions = {}, {}, {}
    represented = deepcopy(case["positions"])
    all_d = set()
    changes = 0
    lost = False
    for pos, machine in zip(case["positions"], represented, strict=True):
        pid = pos["position_id"]
        ds = {d: [Fraction(o["value"])*factor for o in pos[d]] for d in DIRECTIONS}
        for d in DIRECTIONS:
            for raw, number in zip(machine[d], ds[d], strict=True):
                all_d.add(number)
                b = float(number)
                changes += Fraction.from_float(b) != number
                raw["value"] = str(Decimal.from_float(b))
        exact_b[pid], winners = position_reference(pos, factor)
        exact_d[pid], _ = exact_position(ds)
        assert winners == branches[pid]
        lost |= any(v.compare(ZERO) == 0 and exact_d[pid][k].compare(ZERO) != 0 for k,v in exact_b[pid].items())
        positions[pid] = {"fields": certified_fields(exact_b[pid], observed[pid], 20), "branches": winners}
    totals, sources = axis_reference(exact_b)
    original, _ = axis_reference(exact_d)
    assert sources == extrema and len(sources) == 18
    lost |= any(v.compare(ZERO) == 0 and original[k].compare(ZERO) != 0 for k,v in totals.items())
    collision = len(set(map(float, all_d))) != len(all_d)
    failure = "input-collision" if collision else "derived-nonzero-to-zero" if lost else None
    return {"fixture": case, "representedPositions": represented, "positions": positions,
            "totals": certified_fields(totals, observed_axis, 12), "sources": sources, "failure": failure,
            "changedObservations": changes, "changedAxisFields": sorted(k for k in totals if totals[k].compare(original[k]) != 0)}


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--p05-reference":
        m = int(sys.argv[2])
        ref = record(synthetic(f"P05-{m}", generator(m)))
        del ref["representedPositions"]
        print(json.dumps(ref, allow_nan=False))
        return
    extra = witnesses()
    extra["axis-only-mean-loss"] = paired([(["1.00000000000000001"]*5, ["0"]*5), (["2"]*5, ["3"]*5)])
    extra["cross-position-collision"] = paired([(["1"]*5, ["0"]*5), (["1.00000000000000001"]*5, ["2"]*5)])
    extra["P05-six"] = generator(6)
    cases = [*fixtures(), *(synthetic(name, rows) for name,rows in extra.items())]
    print(json.dumps([record(c) for c in cases], allow_nan=False))


if __name__ == "__main__":
    main()
