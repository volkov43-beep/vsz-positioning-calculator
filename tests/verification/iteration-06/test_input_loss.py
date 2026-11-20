"""Deliberate corruptions and independent controls of the 06-2 verifier."""

from copy import deepcopy
from decimal import Decimal
from fractions import Fraction as Q
import math
import unittest

from input_loss import Value, ZERO, budget, conversion, find_collisions, measure, valid_collisions
from precision_failures import blocked_attempt, output_issue, valid_block
from verify_input_loss import witnesses


class Mutations(unittest.TestCase):
    @staticmethod
    def observations(raws):
        return [{**conversion(raw, "um"), "address":{"positionId":"p01","direction":"up","repeat":i}}
                for i, raw in enumerate(raws,1)]

    def test_false_collision(self):
        distinct = self.observations(["1", "2"])
        fake = find_collisions(self.observations(["1", "1.00000000000000001"]))
        self.assertFalse(valid_collisions(distinct, fake))

    def test_missed_collision(self):
        same_b = self.observations(["1", "1.00000000000000001", "1.00000000000000002"])
        real = find_collisions(same_b)
        self.assertTrue(valid_collisions(same_b, real))
        self.assertFalse(valid_collisions(same_b, real[1:]))
        self.assertFalse(valid_collisions(same_b, [real[0], real[0]]))

    def test_vanished_reversal(self):
        ref = measure(witnesses()["REV06-within-series-mean-loss"], "um")
        value = ref["fields"]["p01"]["B_i"]["b"]
        self.assertEqual(output_issue(value,0.)[0], "rounding-mismatch")

    def test_residual_on_exact_zero(self):
        ref = measure(witnesses()["REV06-Bbar-exact-zero"], "um")
        value = ref["fields"]["axis"]["Bbar"]["b"]
        self.assertIsNone(output_issue(value,0.)[0])
        self.assertEqual(output_issue(value,-2.220446049250313e-17)[0], "rounding-mismatch")

    def test_valid_sd_false_variance(self):
        exact_s = Value(terms=((1,Q(80)),))
        sd = math.sqrt(80)
        self.assertIsNone(output_issue(exact_s, sd)[0])
        self.assertEqual(output_issue(Value(80), sd*sd)[0], "rounding-mismatch")

    def test_subnormal_accepted(self):
        actual = math.ulp(0.0)
        reason, proof = output_issue(Value(Q(actual)), actual)
        self.assertEqual(proof["status"], "certified")
        self.assertEqual(reason, "output-subnormal")

    def test_budget_absent_claimed_success(self):
        snapshot = {"unit":"um","rows":witnesses()["ten-distinct-inputs"]}
        missing = budget({"unit":"um"})
        run = blocked_attempt("absent",snapshot,"budget",missing,{"family":"Bbar"},{"unit":"um"})
        self.assertTrue(valid_block(run,snapshot,missing))
        for changed in ({"state":"succeeded"}, {"positions":[]}, {"axis":{}}, {"extrema":{}}):
            self.assertFalse(valid_block({**run,**changed},snapshot,missing))
        old = deepcopy(snapshot)
        snapshot["rows"][0]["up"][0] = "71"
        self.assertEqual(run["inputSnapshot"],old)
        self.assertFalse(valid_block(run,snapshot,missing))


class BudgetAndInput(unittest.TestCase):
    def test_sufficient_implication(self):
        # Finite grid of signed rational inputs in addition to the general proof.
        for yd in map(Q, (-3,0,2)):
            for yb in map(Q, (-2,0,1)):
                impact = abs(yb-yd)
                for bound in (impact,impact+1):
                    field = {"d":Value(yd),"b":Value(yb),"impact":Value(impact),"Q":Value(bound),"unit":"um"}
                    for A in (Q(0),impact,impact+1):
                        for rho in (Q(0),Q(1,4),Q(1)):
                            result = budget(field,A,rho,"um",direct=False)
                            if result=="budget-certified":
                                self.assertLessEqual(impact,A+rho*abs(yd))
                            if impact>A+rho*abs(yd):
                                self.assertEqual(budget(field,A,rho,"um"),"budget-exceeded")

    def test_negative_control_metadata(self):
        # Missing environmental information can qualify both report and procedure.
        import validation_check as validator
        from verify_input_loss import fixtures
        case = next(c for c in fixtures() if c["case_id"]=="N09-incomplete-report-metadata")
        case["context"]["missing_report_fields"] += ["instrument","temperature"]
        status = validator.classify_inputs(case)
        self.assertTrue(status["complete_numeric_input"])
        self.assertEqual({f["level"] for f in status["findings"]},{"report-warning","applicability-warning"})

    def test_canonical_representation(self):
        a = conversion("  −000,00300e+2  ","mm")
        self.assertEqual(a["raw"],"  −000,00300e+2  ")
        self.assertEqual(a["normalized_um"],"-300")
        for raw in ("0.00003","-1.250000000000000000001","1e-308"):
            result = conversion(raw,"mm")
            self.assertEqual(Q(result["normalized_um"]),Q(Decimal(raw))*1000)
            self.assertEqual(result["b"],Q(float.fromhex(result["binary64"])))
        self.assertEqual(output_issue(ZERO,-0.)[0],"rounding-mismatch")


if __name__=="__main__":
    unittest.main()
