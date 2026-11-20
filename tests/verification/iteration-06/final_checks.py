"""Coverage reconciliation, adversarial certificates and negative controls for iteration 06."""

from decimal import Decimal, localcontext
from fractions import Fraction as Q
from hashlib import sha256
import math
import struct

from verify_reference import DIRECTIONS, Value, certify, source_evidence
from bounded_comparison import BoundedComparison
from observations import observe
from precision_failures import blocked_attempt, output_issue, valid_block
from rounding import ComparisonLimit, bits
from verify_input_loss import fixtures, paired, require, to_rows, witnesses
from verify_scale import canonical, from_rows, verify_axis
import numerical_stress as stress


def expression(serialized):
    return Value(Q(serialized["rational"]), tuple((Q(c), Q(r)) for c, r in serialized["roots"]))


def as_float(bit_string):
    return struct.unpack(">d", bytes.fromhex(bit_string))[0]


def reconcile(reference, inputs):
    """Replay each 06-2 b-expression against observed bits. Compare original witnesses by address."""
    packages = {c["case_id"]: c for c in fixtures() if c["category"] != "invalid"}
    extra = witnesses()
    require(set(reference["cases"]) == set(packages), "06-1 case inventory")
    require(set(inputs["sources"]) == set(packages) | set(extra), "06-2 case inventory")
    results = {}
    for name, source in inputs["sources"].items():
        snap = source["snapshot"]
        if name in packages:
            case = packages[name]
            require(snap == {"rows": to_rows(case), "unit": case["units"]["deviation"]}, name)
            original = reference["cases"][name]
            observed = {pid: {key: as_float(p["bits"]) for key, p in row.items()}
                        for pid, row in original["fields"].items()}
            extrema = {k: entry["actual"] for k, entry in original["extrema"].items()}
        else:
            require(snap == {"rows": extra[name], "unit": "um"}, name)
            case = from_rows(name, extra[name])
            # Includes independent checks of branches, extrema and the allowed output domain.
            verify_axis(case)
            rows, axis, _, extrema = observe(case)
            observed = {**rows, "axis": axis}
            original = None
        require(extrema == source["extrema_b"] and observed.keys() == source["fields"].keys(), name)
        digest = sha256()
        fields = 0
        for pid, row in source["fields"].items():
            require(observed[pid].keys() == row.keys(), (name, pid))
            for key, field in sorted(row.items()):
                proof = certify(expression(field["b"]), observed[pid][key])
                require(proof["status"] == "certified", (name, pid, key, proof))
                if original is not None:
                    require(proof == original["fields"][pid][key], (name, pid, key))
                digest.update(canonical([pid, key, proof]) + b"\n")
                fields += 1
        require(fields == 20*len(snap["rows"])+12, name)
        results[name] = {"certified": fields, "sha256": digest.hexdigest()}
    return results


def experimental_controls():
    """Three additional PRE-06 witnesses: compare two precision paths without a cell certificate."""
    z, h = ["0"]*5, ["1000000"]*5
    cases = {
        "EXP-P02-mixed-scale": stress.mixed_scale(),
        "REV06-Bbar-nonzero-after-cancellation": paired([(h,z),(z,h),(["1e-12"]*5,z),(z,z),(z,z)]),
        "REV06-input-zero-signature-change": paired([(["1000000.00000000004"]*4+["999999.99999999984"],h)]*5),
    }
    result = {}
    for name, rows in cases.items():
        first, second = stress.oracle(rows, True), stress.independent_oracle(rows, True)
        stress.cross_check(first, second)
        for tree, digits in ((first, stress.PRECISION), (second, stress.SECOND_PRECISION)):
            with localcontext() as ctx:
                ctx.prec = digits
                for row, p in zip(rows, tree["positions"], strict=True):
                    for direction in DIRECTIONS:
                        raw = [float(x) for x in row[direction]]
                        if tree is first:
                            spread = Q(max(raw)) - Q(min(raw))
                            p["range_"+direction] = Decimal(spread.numerator) / Decimal(spread.denominator)
                        else:
                            xs = list(map(Decimal.from_float, raw))
                            p["range_"+direction] = max(xs)-min(xs)
                        p["twoSd_"+direction] = 2*p["s_"+direction]
        signatures = []
        for tree in (first, second):
            signatures.append([{k: bits(float(v)) for k, v in item.items()} for item in [*tree["positions"], tree["axis"]]])
        require(signatures[0] == signatures[1], name)
        n = sum(map(len, signatures[0]))
        require(n == 20*len(rows)+12, name)
        result[name] = {"experimental_fields": n, "input_sha256": stress.canonical_input_hash(rows),
                        "bits_sha256": sha256(canonical(signatures[0])).hexdigest()}
    return result


def ladder_probes():
    results = {}
    root = Value(terms=((1, Q(2)),))
    for k, expected in ((40,128),(180,256),(350,512),(700,1024),(1300,None)):
        q = Q(math.isqrt(2 << (2*k)), 1 << k)
        require(q*q < 2 < (q + Q(1, 1 << k))**2, k)
        cmp = BoundedComparison()
        try:
            sign = cmp(root, Value(q))
        except ComparisonLimit:
            sign = None
        if expected is None:
            require(sign is None and cmp.exhausted == 1 and cmp.refinements == 3, k)
            # The same separation controls RN at an actual boundary. Retain a failed attempt.
            shifted = Value(1 + Q(1, 2**53) - q) + root
            bounded = BoundedComparison()
            certificate = lambda value, number: certify(value, number, compare=bounded)
            reason, proof = output_issue(shifted, 1., certificate=certificate)
            require(reason == "certificate-resource-limit" and bounded.exhausted == 1, k)
            snap = {"name": "sqrt2-minus-dyadic", "floor": str(q), "shift": "1+2^-53"}
            run = blocked_attempt("ladder/1300", snap, "resource", reason, {"name":"boundary"}, proof)
            require(valid_block(run, snap, reason, source_id="ladder/1300"), k)
            results["failed_rounding"] = {"attempt": run, "comparison": bounded.counts()}
        else:
            require(sign == 1 and cmp.resolved[str(expected)] == 1, k)
        results[str(k)] = {"sign": sign, **cmp.counts()}
    cmp = BoundedComparison()
    a, b = Value(terms=((2,Q(5)),)), Value(terms=((1,Q(20)),))
    require(cmp(a,b) == 0, "exact radical tie")
    half = Value(1+Q(1,2**53)) + a - b
    even = certify(half, 1., compare=cmp)
    odd = certify(half, math.nextafter(1., math.inf), compare=cmp)
    require(even["status"] == "certified" and even["right"] == 0 and odd["status"] == "mismatch", "halfway")
    results["algebraic_tie_and_halfway"] = {"even": even, "odd": odd, **cmp.counts()}
    return results


def mutation_checks(inputs):
    sources = inputs["sources"]
    results = {}

    def reject(case, pid, key, faulty, label):
        exact = expression(sources[case]["fields"][pid][key]["b"])
        proof = certify(exact, faulty)
        require(proof["status"] == "mismatch", label)
        results[label] = {"case": case, "field": [pid, key], "rejected": proof}

    def rational(case, pid, key):
        return expression(sources[case]["fields"][pid][key]["b"]).rational

    t06 = "T06-single-outlier"
    reject(t06, "p03", "variance_up", 80*4/5, "divisor-five")
    # T07/p03 has down as its sole active branch; C=2 and the up branch is zero.
    t07 = "T07-repeatability-branches"
    reject(t07, "p03", "R_i", 2., "drop-down-branch")
    reject(t06, "p03", "B_i", -float(rational(t06, "p03", "B_i")), "sign-reversed")
    t04 = "T04-negative-reversal"
    reject(t04, "axis", "Bbar", abs(float(rational(t04, "axis", "Bbar"))), "absolute-Bbar")
    near = "REV06-near-extrema-equal-rounded-means"
    means = [float(rational(near, pid, "mean_"+d)) for pid in sources[near]["series"] for d in DIRECTIONS]
    reject(near, "axis", "E", max(means)-min(means), "early-rounded-means")
    for case, pid, field, legacy_key in [
        ("P02-mixed-scale", "p02", "sd_up", "s_up"), ("REV06-direction-scale", "axis", "A_down", "A_down")]:
        old = sources[case]["legacy_or_input_witness"][legacy_key]["old_hex"]
        reject(case, pid, field, float.fromhex(old), "legacy-"+legacy_key)
    spec = sources[near]["extrema_b"]["mean_max_up"]
    for name, fake in (("wrong-source",[{"position_id":"p01","direction":"up"}]),
                       ("false-tie",[*spec,{"position_id":"p01","direction":"up"}])):
        # Use the same full ordered metadata comparison as in 06-1.
        evidence = source_evidence(spec, fake)
        require(not evidence["passed"], name)
        results[name] = evidence
    reject(t06, "p03", "variance_up", math.sqrt(80)**2, "variance-from-s")
    m01 = "M01-swap-directions"
    halfway = float(rational(m01, "p00011", "B_i"))
    reject(m01, "p00011", "B_i", math.nextafter(halfway, math.inf), "wrong-RN64")
    unapproved = inputs["groups"]["axis-input"][t06]["evidence"]
    snapshot = unapproved["inputSnapshot"]
    fake_run = {**unapproved, "state":"succeeded", "axis":{}}
    require(not valid_block(fake_run, snapshot, "budget-not-approved"), "unapproved success")
    results["unapproved-success"] = "rejected"
    reason, proof = output_issue(Value(Q(1, 5*(1<<1200))), 0.)
    require(reason == "output-nonzero-to-zero" and proof["exact_sign"] == 1, "fabricated variance zero")
    results["fabricated-zero"] = {"reason":reason, "proof":proof}
    require(len(results) == 13, "mutation inventory")
    return results
