"""Emit only single-position inputs, certified b-bits and exact winning branches for Vitest."""
from decimal import Decimal
from fractions import Fraction
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/verification/iteration-06"))
from verify_reference import DIRECTIONS, ZERO, certify, exact_position, position_reference
from observations import observe
from verify_input_loss import fixtures, paired, witnesses
from verify_scale import from_rows


def records(case):
    rows, _, _, _ = observe(case)
    factor = {"mm": 1000, "um": 1}[case["units"]["deviation"]]
    branch_names = {"C_i": "cross", "R_i_up": "up", "R_i_down": "down"}
    for p in case["positions"]:
        pid = p["position_id"]
        d = {side: [Fraction(o["value"])*factor for o in p[side]] for side in DIRECTIONS}
        distinct = {x for side in DIRECTIONS for x in d[side]}
        represented, winners = position_reference(p, factor)
        exact_source, _ = exact_position(d)
        row = {"name": case["case_id"]+"/"+pid, "unit": case["units"]["deviation"], "input": p}
        if len({float(x) for x in distinct}) < len(distinct):
            row["failure"] = "input-collision"
        elif any(y.compare(ZERO) == 0 and exact_source[k].compare(ZERO) != 0 for k,y in represented.items()):
            row["failure"] = "derived-nonzero-to-zero"
        else:
            proofs = {k: certify(v, rows[pid][k]) for k, v in represented.items()}
            if len(proofs) != 20 or any(p["status"] != "certified" for p in proofs.values()):
                raise ArithmeticError(row["name"])
            row["bits"] = {k: v["bits"] for k, v in proofs.items()}
            row["active"] = [branch_names[w] for w in winners]
        yield row


def main():
    cases = [c for c in fixtures() if c["category"] != "invalid"]
    extra = witnesses()
    # All three public repeatabilities round to 4. Only the exact cross candidate wins.
    up = ["-1", "-1", "0", "1", "1"]
    down = [*up]
    down[2] = str(Decimal.from_float(2.0**-60))
    extra["near-repeatability"] = paired([(up, down)])
    cases.extend(from_rows(name, rows) for name, rows in extra.items())
    print(json.dumps([row for case in cases for row in records(case)], allow_nan=False))


if __name__ == "__main__":
    main()
