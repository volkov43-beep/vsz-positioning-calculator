/** Reduced fractions, with the sign in the numerator. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("Negative radicand");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

function bitLength(n: bigint): number {
  return n.toString(2).length;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export class Q {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint, d = 1n) {
    if (d === 0n) throw new RangeError("Zero denominator");
    const divisor = gcd(n, d) * (d < 0n ? -1n : 1n);
    this.n = n / divisor;
    this.d = d / divisor;
  }

  add(x: Q) { return new Q(this.n * x.d + x.n * this.d, this.d * x.d); }
  sub(x: Q) { return this.add(x.neg()); }
  mul(x: Q) { return new Q(this.n * x.n, this.d * x.d); }
  div(x: Q) { return new Q(this.n * x.d, this.d * x.n); }
  neg() { return new Q(-this.n, this.d); }
  abs() { return this.n < 0n ? this.neg() : this; }
  cmp(x: Q): number {
    const delta = this.n * x.d - x.n * this.d;
    return delta > 0n ? 1 : delta < 0n ? -1 : 0;
  }

  /** floor(log2(x)), x positive. Only sizes of integers go through Number. */
  exponent(): number {
    if (this.n <= 0n) throw new RangeError("Expected positive magnitude");
    const e = bitLength(this.n) - bitLength(this.d);
    return this.cmp(dyadic(1n, e)) < 0 ? e - 1 : e;
  }

  exactRoot(): Q | undefined {
    const n = isqrt(this.n), d = isqrt(this.d);
    if (n*n === this.n && d*d === this.d) return new Q(n, d);
  }

  toString() { return this.d === 1n ? String(this.n) : this.n + "/" + this.d; }
}

export const zero = new Q(0n);
export const one = new Q(1n);

export function dyadic(n: bigint, exponent: number): Q {
  return exponent >= 0 ? new Q(n << BigInt(exponent)) : new Q(n, 1n << BigInt(-exponent));
}
