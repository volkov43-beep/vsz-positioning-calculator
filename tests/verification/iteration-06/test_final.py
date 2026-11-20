"""Regressions for bounded comparison and identity checks in the synthetic verifier."""

from copy import deepcopy
from fractions import Fraction as Q
import unittest

from final_checks import ladder_probes
from bounded_comparison import LEVELS, root_enclosure
from precision_failures import blocked_attempt, valid_block


class FinalVerificationTests(unittest.TestCase):
    def test_enclosures_at_widely_separated_scales(self):
        for exponent in (-1075, -51, -1, 0, 1, 52, 1024):
            for radicand in (Q(3, 4), Q(7, 4), Q(17, 4)):
                q = radicand * Q(2)**exponent
                for level in LEVELS:
                    lo, hi = root_enclosure(q, level)
                    self.assertLessEqual(lo*lo, q)
                    self.assertGreater(hi*hi, q)
                    # Hull width is one local significand unit.
                    self.assertLessEqual((hi-lo) * (1 << (level-1)), lo)

    def test_escalation_and_failure(self):
        self.assertEqual(ladder_probes()["1300"]["exhausted"], 1)

    def test_key_and_missing_fields(self):
        snapshot = {"raw": "1.00", "unit": "um"}
        reason = "budget-not-approved"
        run = blocked_attempt("key-probe", snapshot, "budget", reason, {"family":"Bbar"}, {"unit":"um"})
        self.assertTrue(valid_block(run, snapshot, reason, source_id="key-probe"))
        for key in ("trialId", "inputRevision", "inputDigest", "profileId", "profileVersion", "sdMethod",
                    "algorithmVersion", "numericalPolicyVersion", "runId", "origin", "methodStatus", "errors"):
            with self.subTest(key=key):
                damaged = deepcopy(run)
                del damaged[key]
                self.assertFalse(valid_block(damaged, snapshot, reason))
        for changes in ({"inputRevision":True}, {"numericalPolicyVersion":"obsolete"}, {"errors":[]},
                        {"errors":[{}]}, {"axis":{}}, {"trialId":"other"}):
            self.assertFalse(valid_block({**run, **changes}, snapshot, reason))
        self.assertFalse(valid_block(run, snapshot, reason, source_id="another-attempt"))


if __name__ == "__main__":
    unittest.main()
