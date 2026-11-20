import { fromBits, rationalBits } from "./binary64";
import { CoreIssue, type Address } from "./diagnostics";
import { Q, dyadic, isqrt, one, zero } from "./rational";

type Term = { coefficient: Q; radicand: Q };
const LEVELS = [128, 256, 512, 1024] as const;

/** Rational part plus one term per distinct rational square class. */
export class Expr {
  readonly base: Q;
  readonly terms: readonly Term[];

  constructor(base: Q = zero, terms: readonly Term[] = []) {
    const distinct: Term[] = [];
    for (const { coefficient, radicand } of terms) {
      if (!coefficient.n || !radicand.n) continue;
      const root = radicand.exactRoot();
      if (root) {
        base = base.add(coefficient.mul(root));
        continue;
      }
      let matched = false;
      for (const existing of distinct) {
        const ratio = radicand.div(existing.radicand).exactRoot();
        if (ratio) {
          existing.coefficient = existing.coefficient.add(coefficient.mul(ratio));
          matched = true;
          break;
        }
      }
      if (!matched) distinct.push({ coefficient, radicand });
    }
    this.base = base;
    this.terms = distinct.filter(term => term.coefficient.n !== 0n);
  }

  static root(radicand: Q) { return new Expr(zero, [{ coefficient: one, radicand }]); }
  add(x: Expr) { return new Expr(this.base.add(x.base), [...this.terms, ...x.terms]); }
  scale(k: Q) {
    return new Expr(this.base.mul(k), this.terms.map(t => ({ ...t, coefficient: t.coefficient.mul(k) })));
  }
  sub(x: Expr) { return this.add(x.scale(new Q(-1n))); }
  isZero() { return !this.terms.length && this.base.n === 0n; }

  /** Inclusive bounds. Root exponent and interval width depend on the local radicand. */
  bounds(precision: number): [Q, Q] {
    let lo = this.base, hi = this.base;
    for (const { coefficient, radicand } of this.terms) {
      const step = dyadic(1n, Math.floor(radicand.exponent() / 2) + 1 - precision);
      const scaled = radicand.div(step.mul(step));
      const k = isqrt(scaled.n / scaled.d);
      const lower = step.mul(new Q(k)), upper = lower.add(step);
      lo = lo.add(coefficient.mul(coefficient.n > 0n ? lower : upper));
      hi = hi.add(coefficient.mul(coefficient.n > 0n ? upper : lower));
    }
    return [lo, hi];
  }
}

function exhausted(address: Address, operation: string): never {
  throw new CoreIssue("resource", "certificate-resource-limit", "Сертификат не получен в пределах 1024 бит.",
    address, { operation, precisionBits: LEVELS });
}

export function compare(left: Expr, right: Expr, address: Address): number {
  const diff = left.sub(right);
  if (!diff.terms.length) return diff.base.cmp(zero);
  for (const p of LEVELS) {
    const [lo, hi] = diff.bounds(p);
    if (lo.n > 0n) return 1;
    if (hi.n < 0n) return -1;
  }
  return exhausted(address, "order");
}

function checkedOutput(bits: bigint, exactZero: boolean, address: Address): number {
  const value = fromBits(bits);
  let reason: string;
  if (!Number.isFinite(value)) reason = "output-overflow";
  else if (value === 0 && !exactZero) reason = "output-nonzero-to-zero";
  else if (value !== 0 && Math.abs(value) < 2 ** -1022) reason = "output-subnormal";
  else return value;
  throw new CoreIssue("rounding", reason, "Поле выходит за поддерживаемый диапазон результата.", address,
    { bits: bits.toString(16).padStart(16, "0"), exactZero });
}

/** RN is monotone: identical endpoint bits certify every value in the enclosure. */
export function rounded(value: Expr, address: Address): number {
  if (!value.terms.length) return checkedOutput(rationalBits(value.base), value.isZero(), address);
  for (const p of LEVELS) {
    const [lo, hi] = value.bounds(p);
    const lower = rationalBits(lo);
    if (lower === rationalBits(hi)) return checkedOutput(lower, false, address);
  }
  return exhausted(address, "round");
}
