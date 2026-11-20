"""Sources of observed binary64 values. Neither supplies the mathematical reference."""

from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
from hashlib import sha256
import importlib.util
from pathlib import Path
import sys

import independent_check as v1

DIRECTIONS = ("up", "down")
PRO_SHA256 = "d256720939417bb91bf20770301128f295b2a2ad835329d44ba369e24670993b"


def load_candidate(path):
    """Optional, explicitly selected, hash-pinned PRE-06 experiment."""
    if sha256(Path(path).read_bytes()).hexdigest() != PRO_SHA256:
        raise ValueError("Unexpected PRE-06 candidate SHA-256")
    spec = importlib.util.spec_from_file_location("pre06_subject", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def observe(case, candidate=None):
    # The public 03A path receives the exact terminating decimals of *represented*
    # inputs. Decimal.from_float is exact, including when the context has low precision.
    represented = deepcopy(case)
    represented["units"]["deviation"] = "um"
    factor = {"mm": 1000, "um": 1}[case["units"]["deviation"]]
    source_rows, machine_rows = [], []
    for position in represented["positions"]:
        dec = {"id": position["position_id"]}
        machine = {"id": position["position_id"]}
        for direction in DIRECTIONS:
            series = position[direction]
            dec[direction] = [Fraction(item["value"]) * factor for item in series]
            machine[direction] = [str(Decimal.from_float(float(q))) for q in dec[direction]]
            for item, text in zip(series, machine[direction], strict=True):
                item["value"] = text
        source_rows.append(dec)
        machine_rows.append(machine)

    audit = v1.Audit()
    result = v1.calculate(represented, audit)
    if audit.errors:
        raise ValueError(audit.errors)
    branches = {p["position_id"]: p["active_R_branches"] for p in result["positions"]}
    fields = {}
    for p in result["positions"]:
        pid = p["position_id"]
        fields[pid] = {key: float(p[key]) for key in v1.POSITION_FIELDS}
        for direction in DIRECTIONS:
            stats = p["series"][direction]
            samples = stats["fractions"]
            fields[pid]["range_" + direction] = float(max(samples) - min(samples))
            fields[pid]["twoSd_" + direction] = float(2 * stats["sd"])
    axis = {key: float(value) for key, value in result["axis"].items()}

    if candidate is not None:
        tree, _ = candidate.calculate(source_rows)
        aliases = {"sd_up": "s_up", "sd_down": "s_down", "R_i_up": "R_up", "R_i_down": "R_down",
                   "B_i": "B", "C_i": "C", "R_i": "R"}
        for row, position in zip(source_rows, tree["positions"], strict=True):
            pid = row["id"]
            mapping = {aliases.get(key, key): key for key in fields[pid]}
            if set(mapping) != set(position):
                raise ValueError(f"{pid}: candidate position fields differ")
            fields[pid] = {mapping[key]: expression.rounded() for key, expression in position.items()}
        axis = {key: expression.rounded() for key, expression in tree["axis"].items()}
        # The subject's checker enumerates its own exact winners. Passing b here
        # also handles fixtures for which the original decimal winners changed.
        checked = candidate.metadata_checks(tree, machine_rows, result)
        if checked != len(branches) + len(result["extrema"]):
            raise ValueError("Incomplete candidate source check")
    return fields, axis, branches, result["extrema"]
