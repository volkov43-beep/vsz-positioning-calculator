"""Finite relative-precision radical enclosures for verification of the PRE-06 proposal."""

from collections import Counter
from fractions import Fraction
from functools import lru_cache
from math import isqrt

from independent_check import normalize_radicals
from rounding import ComparisonLimit

LEVELS = (128, 256, 512, 1024)


@lru_cache(maxsize=4096)
def root_enclosure(radicand, precision):
    """Consecutive p-significand dyadics enclosing a positive irrational root."""
    n, d = radicand.as_integer_ratio()
    exponent = n.bit_length() - d.bit_length()
    power = Fraction(2) ** exponent
    if radicand < power:
        exponent -= 1
    shift = exponent // 2 - precision + 1
    step = Fraction(2) ** shift
    scaled = radicand / (step * step)
    index = isqrt(scaled.numerator // scaled.denominator)
    return index * step, (index + 1) * step


class BoundedComparison:
    def __init__(self):
        self.resolved = Counter()
        self.refinements = 0
        self.exhausted = 0

    def __call__(self, left, right):
        terms = [*left.terms, *((-c, r) for c, r in right.terms)]
        base, roots = normalize_radicals(left.rational - right.rational, terms)
        if not roots:
            self.resolved["exact"] += 1
            return (base > 0) - (base < 0)
        for level in LEVELS:
            if level != LEVELS[0]:
                self.refinements += 1
            lower = upper = base
            for coeff, radicand in roots:
                low, high = root_enclosure(radicand, level)
                if coeff < 0:
                    low, high = high, low
                lower += coeff * low
                upper += coeff * high
            if lower > 0 or upper < 0:
                self.resolved[str(level)] += 1
                return 1 if lower > 0 else -1
        self.exhausted += 1
        raise ComparisonLimit("No sign certificate at 1024 significand bits")

    def counts(self):
        return {"resolved": dict(self.resolved), "refinements": self.refinements, "exhausted": self.exhausted}
