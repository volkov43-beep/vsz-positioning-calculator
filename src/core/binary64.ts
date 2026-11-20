import { Q, dyadic, zero } from "./rational";

const HIDDEN = 1n << 52n;
const SIGN = 1n << 63n;
const INF = 0x7ff0000000000000n;

/** Nearest integer quotient, with even mantissa at an exact midpoint. */
function nearestInteger(x: Q): bigint {
  const q = x.n / x.d;
  const twiceRemainder = 2n * (x.n % x.d);
  return twiceRemainder > x.d || (twiceRemainder === x.d && (q & 1n) === 1n) ? q + 1n : q;
}

export function rationalBits(value: Q): bigint {
  if (value.n === 0n) return 0n;
  const sign = value.n < 0n ? SIGN : 0n;
  const x = value.abs();
  let e = x.exponent();
  if (e > 1023) return sign | INF;
  if (e < -1075) return sign;
  if (e < -1022) return sign | nearestInteger(x.div(dyadic(1n, -1074)));
  let significand = nearestInteger(x.div(dyadic(1n, e - 52)));
  if (significand === 2n * HIDDEN) {
    significand = HIDDEN;
    e++;
  }
  if (e > 1023) return sign | INF;
  return sign | (BigInt(e + 1023) << 52n) | (significand - HIDDEN);
}

export function fromBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

export function bitPattern(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

export function exactBinary(value: number): Q {
  const bits = bitPattern(value);
  const exp = Number((bits >> 52n) & 2047n);
  if (exp === 2047) throw new RangeError("Non-finite binary64");
  let mantissa = bits & (HIDDEN - 1n);
  if (exp !== 0) mantissa += HIDDEN;
  if (mantissa === 0n) return zero;
  return dyadic(bits & SIGN ? -mantissa : mantissa, exp ? exp - 1075 : -1074);
}
