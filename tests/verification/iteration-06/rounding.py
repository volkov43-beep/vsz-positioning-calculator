"""Independent binary64 cell certificates. Only exact rational predicates decide acceptance."""

from dataclasses import dataclass
from fractions import Fraction
from math import copysign, isinf, isnan, nextafter
from struct import pack

from independent_check import compare_radical_expressions


@dataclass(frozen=True)
class Value:
    """A rational plus a short sum of rational multiples of square roots."""
    rational: Fraction = Fraction(0)
    terms: tuple = ()

    def __add__(self, other):
        return Value(self.rational + other.rational, self.terms + other.terms)

    def scaled(self, factor):
        return Value(self.rational * factor, tuple((c * factor, v) for c, v in self.terms))

    def __sub__(self, other):
        return self + other.scaled(-1)

    def compare(self, other):
        # v1 proves equality after combining rational-square classes, then encloses
        # remaining radicals using integer square roots and directed rational bounds.
        return compare_radical_expressions((self.rational, list(self.terms)),
                                           (other.rational, list(other.terms)))


ZERO = Value()
INFINITY = float("inf")
# The finite successor in the unbounded-exponent format would be 2**1024.
VIRTUAL_LIMIT = Fraction(2**1024)
OVERFLOW_MIDPOINT = VIRTUAL_LIMIT - 2**970


def bits(x):
    return pack(">d", x).hex()


def neighbor(x, toward):
    adjacent = nextafter(x, toward)
    if isinf(adjacent):
        return VIRTUAL_LIMIT if adjacent > 0 else -VIRTUAL_LIMIT
    return Fraction.from_float(adjacent)


def certify(value, actual):
    """Certify the proposed bit pattern directly, without rounding the reference.

    Return a witness of membership (left/right are exact comparison signs).
    Rejection and failure to separate at the interval limit are distinct outcomes.
    """
    evidence = {"bits": bits(actual)}
    try:
        if isnan(actual):
            return {**evidence, "status": "mismatch"}
        if isinf(actual):
            magnitude = value.scaled(1 if actual > 0 else -1)
            relation = magnitude.compare(Value(OVERFLOW_MIDPOINT))
            accepts = relation >= 0
            evidence["overflow_threshold"] = relation
        else:
            center = Fraction.from_float(actual)
            lo = (neighbor(actual, -INFINITY) + center) / 2
            hi = (center + neighbor(actual, INFINITY)) / 2
            left, right = value.compare(Value(lo)), value.compare(Value(hi))
            even = int(evidence["bits"], 16) % 2 == 0
            accepts = (left > 0 or (even and left == 0)) and (right < 0 or (even and right == 0))
            evidence.update(left=left, right=right, even=even)
            if actual == 0:
                sign = value.compare(ZERO)
                evidence["exact_sign"] = sign
                accepts = accepts and ((sign < 0) == (copysign(1, actual) < 0))
    except ArithmeticError as error:
        return {**evidence, "status": "uncertified", "reason": str(error)}
    return {**evidence, "status": "certified" if accepts else "mismatch"}
