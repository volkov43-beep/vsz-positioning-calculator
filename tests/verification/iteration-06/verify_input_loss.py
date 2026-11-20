#!/usr/bin/env python3
"""Reproduce the two-layer distinction, input bounds and failure contracts of iteration 06-2."""

import argparse
from collections import Counter
from decimal import Decimal
from fractions import Fraction as Q
from hashlib import sha256
import json
import math
from pathlib import Path
import sys

from input_loss import (DIRECTIONS, Value, ZERO, absolute, budget, conversion, find_collisions,
                        measure, exact_position, valid_collisions)
from precision_failures import blocked_attempt, output_issue, valid_block
from verify_reference import FIXTURES, certify
from rounding import bits
import numerical_stress as legacy
import validation_check as validator


def encode(x):
    if isinstance(x, Q):
        return str(x)
    if isinstance(x, Value):
        return {"rational": str(x.rational), "roots": [[str(c), str(v)] for c, v in x.terms if c and v]}
    raise TypeError(type(x).__name__)


def require(ok, name):
    if not ok:
        raise AssertionError(name)


class Checks:
    def __init__(self):
        self.groups = {}
        self.counts = Counter()
        self.errors = []

    def add(self, group, name, expected, observed, evidence=None):
        checks = self.groups.setdefault(group, {})
        if name in checks:
            raise ValueError(name)
        checks[name] = {"expected": expected, "observed": observed, "evidence": evidence}
        if expected != observed:
            self.errors.append(group + "/" + name)

    def gate(self, group, name, expected, reason, snapshot, stage, field, evidence):
        run = None
        if reason:
            run = blocked_attempt(group+"/"+name, snapshot, stage, reason, field, evidence)
            require(valid_block(run, snapshot, reason, source_id=group+"/"+name), name + ": incomplete failure envelope")
        self.add(group, name, expected or "checked", reason or "checked", run or evidence)
        if expected:
            self.counts["expected_blocks"] += 1
        if reason and reason == expected:
            self.counts["matched_blocks"] += 1
        if reason and reason != expected:
            self.counts["unexpected_blocks"] += 1


def fixtures():
    manifest = json.loads((FIXTURES/"manifest.json").read_text())
    for item in manifest["cases"]:
        raw = (FIXTURES/item["path"]).read_bytes()
        require(sha256(raw).hexdigest() == item["sha256"], item["case_id"] + ": digest")
        yield json.loads(raw)


def to_rows(case):
    return [{"id": p["position_id"], "target_mm": p["target_mm"],
             **{d: [x["value"] for x in p[d]] for d in DIRECTIONS}} for p in case["positions"]]


def paired(pairs):
    return [{"id": f"p{i+1:02d}", "target_mm": str(i*250), "up": list(up), "down": list(down)}
            for i, (up, down) in enumerate(pairs)]


def witnesses():
    zeros, ones = ["0"]*5, ["1"]*5
    base = ["1000000", *zeros[1:]]
    mean = paired([(base, base)]*5)
    mean[0]["up"][-1] = "1e-12"
    extrema = paired([(ones, ones)]*5)
    extrema[1]["up"][-1] = str(Decimal.from_float(math.nextafter(1., 2.)))
    return {
        "REV06-within-series-mean-loss": mean,
        "REV06-direction-scale": paired([(["1000000"]*5, ["-1e-12", "-1e-12", "0", "1e-12", "1e-12"])]*5),
        "REV06-Bbar-exact-zero": paired([([a, *zeros[1:]], zeros) for a in ("0.5", "1", "-1.5", "0", "0")]),
        "REV06-near-extrema-equal-rounded-means": extrema,
        "ten-distinct-inputs": paired([(["-1.99999999999999999", "-1", "0", "1", "2"],
                                        ["-4", "-3", ".5", "2.5", "4"])]*5),
    }


def lex_checks(suite):
    # Finite underflows retain the real error; overflow has no finite rational b or e.
    tests = [
        ("positive", "+12.500", "um", "12.5", None), ("negative", "-2.50", "um", "-2.5", None),
        ("comma", "  −0,0100 ", "mm", "-10", None), ("scientific", "2,50E-3", "mm", "2.5", None),
        ("raw-minus-zero", "-0,00e+3", "um", "0", None), ("single-round", "0.00003", "mm", "0.03", None),
        ("large-normal", "1e308", "um", "1"+"0"*308, None), ("subnormal-input", "5e-324", "um", "0."+"0"*323+"5", None),
        ("underflow", "-1e-400", "um", "-0."+"0"*399+"1", "input-nonzero-to-zero"),
        ("overflow", "1e309", "um", "1"+"0"*309, "input-nonfinite"),
        ("mixed", "1,0.0", "um", None, "syntax-invalid"), ("grouped", "1 000", "um", None, "syntax-invalid"),
        ("suffix", "1,2abc", "um", None, "syntax-invalid"), ("blank", " ", "um", None, "syntax-invalid"),
        ("nan", "NaN", "um", None, "syntax-invalid"), ("infinity", "-Infinity", "um", None, "syntax-invalid"),
        ("boolean", False, "um", None, "syntax-invalid"), ("unknown-unit", "1", "counts", None, "unit-unknown")]
    for name, raw, unit, normalized, expected in tests:
        trace = conversion(raw, unit)
        require(trace["raw"] == raw and trace["unit"] == unit and trace.get("normalized_um") == normalized, name)
        if trace.get("b") is not None:
            require(Q(float.fromhex(trace["binary64"])) == trace["b"] == trace["d"] + trace["error"], name)
        if name == "single-round":
            require(bits(float(raw)*1000) != trace["bits"] == bits(float("0.03")), name)
        if name == "raw-minus-zero":
            require(trace["bits"] == "0"*16, name)
        if name == "underflow":
            require(trace["binary64"] == (-0.0).hex() and trace["error"] == -trace["d"], name)
        stage = "parse" if trace.get("reason") in ("syntax-invalid", "unit-unknown") else "conversion"
        field = {"kind":"observation", "positionId":"p01", "direction":"up", "repeat":1,
                 "name":"unit" if trace.get("reason") == "unit-unknown" else "raw"}
        suite.gate("lexical", name, expected, trace.get("reason"), {"raw": raw, "unit": unit}, stage,
                   field, trace)


def collision_checks(suite):
    a, b = "1", "1.00000000000000001"
    p = ("p01", "up", 1)
    for name, second, spelling, expected in [
        ("within-series", ("p01","up",2), b, True), ("across-directions", ("p01","down",1), b, True),
        ("across-positions", ("p02","up",1), b, True), ("equal-spellings", ("p02","down",4), "1.00", False)]:
        vals = [{**conversion(s, "um"), "address": dict(zip(("positionId","direction","repeat"), addr))}
                for s, addr in [(a,p),(spelling,second)]]
        witnesses = find_collisions(vals)
        require(valid_collisions(vals, witnesses), name)
        if expected:
            require(len(witnesses)==1 and [witnesses[0][k] for k in ("first","second")]==[o["address"] for o in vals], name)
        suite.gate("collision-scope", name, "input-collision" if expected else None,
                   "input-collision" if witnesses else None, {"entries":[[list(p),a],[list(second),spelling]]},
                   "collision", vals[1]["address"], witnesses or {"distinct_exact_values":1})


def legacy_checks(name, rows, measured):
    fields = measured["fields"]
    machine = fields["axis"]
    if name == "ten-distinct-inputs":
        first = measured["observations"][:10]
        f = fields["p01"]["B_i"]
        require(len({x["b"] for x in first}) == 10 and not measured["collisions"], name)
        for field in (f, machine["B"], machine["Bbar"]):
            require(field["d"].compare(Value(Q(2,10**18)))==0 and field["b"].compare(ZERO)==0, name)
        return {"distinct_b_in_position":10, "decimal_Bi":f["d"], "binary_Bi":f["b"]}
    if name == "P02-offset-near-ulp":
        sd = fields["p01"]["sd_up"]
        relative = Q(16415321826934814453125,10**23)
        require(not measured["collisions"] and sd["impact"].compare(sd["d"].scaled(relative)) == 0
                and sd["impact_vs_Q"] == 0, name)
        return {"relative_sd_error":relative, "bound_attained":True}
    if name == "P02-offset-resolvable":
        obs = measured["observations"]
        require(not measured["collisions"] and len({o["b"] for o in obs})==len({o["d"] for o in obs}), name)
        return {"distinct_d":len({o["d"] for o in obs}), "all_preserved":True}
    if name == "P02-offset-collapsed":
        require(bool(measured["collisions"]) and fields["p01"]["sd_up"]["d"].compare(ZERO)>0
                and fields["p01"]["sd_up"]["b"].compare(ZERO)==0, name)
        return {"decimal_sd":fields["p01"]["sd_up"]["d"], "binary_sd":fields["p01"]["sd_up"]["b"]}
    if not (name.startswith("REV06-") or name=="P02-mixed-scale"):
        return None
    probe = legacy.binary_probe(rows, local_first=(name != "P02-mixed-scale"))
    observed = {}
    tiny = Q.from_float(1e-12)

    def check(key, expected, old, policy, wrong):
        require(policy.compare(expected)==0 and wrong(old), name+"/"+key)
        observed[key] = {"old_hex":old.hex(), "exact_b":policy, "expected":expected}

    if name == "REV06-within-series-mean-loss":
        delta = Value(tiny/5)
        mu = fields["p01"]["mean_up"]["b"]
        observed_mu = probe["positions"][0]["mean_up"]
        require(mu.compare(Value(200000) + delta) == 0 and Q(observed_mu) == 200000, name)
        require(certify(mu, observed_mu)["status"] == "certified", name)
        observed["mean_up"] = {"old_public_hex": observed_mu.hex(), "exact_working_mean": mu,
                               "residual_required_downstream": delta}
        check("B_i", delta, probe["positions"][0]["B"], fields["p01"]["B_i"]["b"], lambda x:x==0)
        for k, v in {"B":delta, "E":delta, "E_up":delta, "M":Value(tiny/10), "Bbar":Value(tiny/25)}.items():
            check(k, v, probe["axis"][k], machine[k]["b"], lambda x:x==0)
    elif name == "REV06-direction-scale":
        check("A_down", Value(4*tiny), probe["axis"]["A_down"], machine["A_down"]["b"], lambda x:x==0)
        check("s_down", Value(tiny), probe["positions"][0]["s_down"], fields["p01"]["sd_down"]["b"],
              lambda x:certify(Value(tiny), x)["status"]=="certified")
    elif name == "REV06-Bbar-exact-zero":
        check("Bbar", ZERO, probe["axis"]["Bbar"], machine["Bbar"]["b"], lambda x:x!=0)
        require(certify(machine["Bbar"]["b"], 0.)["status"]=="certified", name)
    elif name == "REV06-near-extrema-equal-rounded-means":
        vals = [p["mean_up"] for p in probe["positions"]]
        rounded_sources = [r["id"] for r,v in zip(rows,vals) if v==max(vals)]
        exact_sources = measured["extrema_b"]["mean_max_up"]
        require(len(rounded_sources)==5 and exact_sources==[{"position_id":"p02","direction":"up"}], name)
        for row in rows:
            require(certify(fields[row["id"]]["mean_up"]["b"], 1.)["status"]=="certified",name)
        check("E-from-public-means", Value(Q(1,5*2**52)), max(vals)-min(vals), machine["E"]["b"], lambda x:x==0)
        observed["source_ids"] = {"from_rounded":rounded_sources, "true":exact_sources,
                                  "legacy_axis_E_hex":probe["axis"]["E"].hex()}
    else:
        old = probe["positions"][1]["s_up"]
        check("s_up", Value(tiny), old, fields["p02"]["sd_up"]["b"], lambda x:x==0)
        # Even the absolute term of the historical global-scale tolerance admits the false zero.
        limit = Q(128,2**52)*max(abs(o["b"]) for o in measured["observations"])
        require(Value(limit).compare(Value(tiny))>0,name)
        observed["old_global_absolute_term_um"] = limit
    return observed


def budget_checks(suite, loss_case, conservative_case):
    tiny_field = loss_case["fields"]["p01"]["B_i"]
    delta = tiny_field["d"].rational  # exact disappearance: b=0, |y(d)|=delta
    # Parameter witnesses derived from the test data. None is a proposed operating budget.
    conservative = conservative_case["fields"]["axis"]["E"]
    require(conservative["impact"].compare(ZERO)==0 and conservative["Q"].compare(ZERO)>0, "conservative E")
    for name, field, A, rho, direct, expected in [
        ("sufficient-equality",tiny_field,delta,Q(0),True,"budget-certified"),
        ("direct-excess",tiny_field,delta/2,Q(1,4),True,"budget-exceeded"),
        ("no-direct-proof",tiny_field,delta/2,Q(1,4),False,"budget-uncertified"),
        ("conservative-bound",conservative,Q(0),Q(0),False,"budget-uncertified"),
        ("independent-direct-proof",conservative,Q(0),Q(0),True,"budget-certified"),
        ("relative-boundary",tiny_field,delta*2,Q(1),True,"budget-certified"),
        ("unapproved",tiny_field,None,None,True,"budget-not-approved")]:
        label = budget(field,A,rho,field["unit"],direct=direct)
        if label=="budget-certified":
            require(field["impact"].compare(Value(A)+absolute(field["d"]).scaled(rho))<=0, name)
        ev = {"classification":label,"A":A,"rho":rho,"unit":field["unit"],"field_values":field,
              "direct_excess_test":direct}
        source = loss_case if field is tiny_field else conservative_case
        snapshot = {**source["snapshot"], "test_A": str(A), "test_rho": str(rho)}
        suite.gate("budget",name,None if expected=="budget-certified" else expected,
                   None if label=="budget-certified" else label, snapshot,
                   "budget",{"family":"B_i" if field is tiny_field else "E","unit":field["unit"]},ev)
    variance = loss_case["fields"]["p01"]["variance_up"]
    try:
        budget(variance, Q(0), Q(0), "um")
    except ValueError:
        rejected = True
    else:
        rejected = False
    suite.add("budget","variance-unit",True,rejected,{"required":"um2","supplied":"um"})


def output_checks(suite):
    sub = Q(1,2**1074)
    upper = Q(2**1024)
    axis_field = {"kind":"axis","name":"A","unit":"um"}
    # An expression strictly above the halfway point, unresolved at the 03A comparator limit.
    scale = 10**2600
    floor = math.isqrt(2*scale*scale)
    require(floor*floor < 2*scale*scale < (floor+1)**2, "positive separation")
    near_half = Value(1+Q(1,2**53)-Q(floor,scale), ((1,Q(2)),))
    for name, exact, actual, wanted in [
        ("true-zero",ZERO,0.,None), ("true-zero-wrong-sign",ZERO,-0.,"rounding-mismatch"),
        ("vanished",Value(sub/4),0.,"output-nonzero-to-zero"),
        ("subnormal",Value(sub),math.ulp(0.),"output-subnormal"),
        ("minimum-normal",Value(Q(sys.float_info.min)),sys.float_info.min,None),
        ("infinity",Value(upper),math.inf,"output-overflow"), ("nan",Value(1),math.nan,"output-nan"),
        ("missing-proof",Value(1),1.,"rounding-uncertified"),
        ("limit-at-halfway",near_half,1.,"certificate-resource-limit")]:
        if name=="missing-proof":
            # Simulate an observed result received without its certificate.
            reason, proof = output_issue(exact,actual,certificate=lambda *_:{"status":"uncertified","reason":"absent"})
        else:
            reason, proof = output_issue(exact,actual)
        stage = "resource" if reason=="certificate-resource-limit" else "rounding"
        suite.gate("output",name,wanted,reason,{"probe":name,"operand":encode(exact),"observed_bits":bits(actual)},
                   stage,axis_field,proof)

    # Single outlier t, remaining four zero gives sample v=t²/5 and s=|t|/sqrt(5).
    for name, t, expected in [("normal-s-vanished-v",Q(1,2**600),"output-nonzero-to-zero"),
                               ("overflowing-square-finite-v",Q(2**512),None)]:
        vals = [Q(0)]*4+[t]
        p,_ = exact_position({"up":vals, "down":vals})
        variance = t*t/5
        from mpmath import mp
        with mp.workdps(100):
            s = float((mp.mpf(t.numerator)/t.denominator)/mp.sqrt(5))
        s_reason, s_proof = output_issue(p["sd_up"],s)
        v_reason, v_proof = output_issue(p["variance_up"],float(variance))
        require(s_reason is None and variance==p["variance_up"].rational, name)
        if expected is None:
            require(math.isinf(float(t)*float(t)) and math.isfinite(float(variance)),name)
        suite.gate("output",name,expected,v_reason,{"unit":"um","series_up":[str(Decimal.from_float(float(x))) for x in vals]}, "rounding",
                   {"positionId":"p01","direction":"up","name":"variance","unit":"um2"},
                   {"sd_certificate":s_proof,"variance_certificate":v_proof,"exact_variance":variance})


def run():
    suite = Checks()
    cases, negative = {}, {}
    lex_checks(suite)
    collision_checks(suite)
    output_checks(suite)
    corpus = {}
    for case in fixtures():
        name = case["case_id"]
        if case["category"]=="invalid":
            classified = validator.classify_inputs(case)
            wanted = case["expected_validation"]
            primary = classified["primary"]
            require(primary and all(primary[k]==wanted[k] for k in ("level","arithmetic","class_ru")),name)
            require(not classified["zero_substitution_performed"] and not classified["procedure_confirmed"],name)
            suite.add("negative-v1", name, wanted["level"], primary["level"],
                      {"arithmetic":classified["arithmetic"], "findings":classified["findings"],
                       "complete_input":classified["complete_numeric_input"]})
            negative[name] = primary["level"]
        else:
            corpus[name] = (to_rows(case),case["units"]["deviation"])
    corpus.update({name:(rows,"um") for name,rows in witnesses().items()})
    for name,(rows,unit) in corpus.items():
        result = measure(rows,unit)
        counts = Counter(budget(f) for group in result["fields"].values() for f in group.values())
        num_fields = len(rows)*20+12
        require(counts=={"budget-not-approved":num_fields},name)
        suite.counts["bound_fields"] += num_fields
        suite.counts["variances_um2"] += 2*len(rows)
        suite.counts["observations"] += 10*len(rows)
        suite.counts["positions"] += len(rows)
        result["legacy_or_input_witness"] = legacy_checks(name,rows,result)
        cases[name] = result
        if result["collisions"]:
            issue = result["collisions"][0]
            reason, stage, where, evidence = "input-collision","collision",issue["second"],issue
        else:
            reason, stage = "budget-not-approved", "budget"
            where = {"kind":"axis","family":"Bbar","unit":"um"}
            evidence = {"by_status":dict(counts), "representative":where, "variance_unit":"um2"}
        suite.gate("axis-input",name,"input-collision" if name=="P02-offset-collapsed" else "budget-not-approved",
                   reason,result["snapshot"],stage,where,evidence)
    budget_checks(suite,cases["ten-distinct-inputs"],cases["T08-variable-m12"])
    require(Counter(negative.values())=={"input-error":17,"mathematical-error":1,
            "applicability-warning":2,"report-warning":1},"N01–N10")
    suite.counts["unexpected_blocks"] += 0
    return {"passed":not suite.errors,"unexpected":suite.errors,"counts":dict(suite.counts),
            "groups":suite.groups,"sources":cases,"negative_classes":dict(Counter(negative.values()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,help="New JSON file outside the repository")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Run without -O to retain fixture checks")
    if args.output and args.output.resolve().is_relative_to(FIXTURES.parents[2]):
        parser.error("Choose a new file outside the repository")
    report = run()
    if args.output:
        with args.output.open("x",encoding="utf-8") as out:
            json.dump(report,out,default=encode,ensure_ascii=False,sort_keys=True,allow_nan=False,indent=2)
            out.write("\n")
    print(json.dumps({"passed":report["passed"],"counts":report["counts"],"unexpected":report["unexpected"],
                      "group_sizes":{k:len(v) for k,v in report["groups"].items()}},indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
