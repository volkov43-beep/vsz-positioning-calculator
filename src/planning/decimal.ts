import { normalize } from "../core/input";
import { CoreIssue } from "../core/diagnostics";
import { Q } from "../core/rational";
import { issue, type Finding, type RawMm } from "./types";

export function readMm(raw: RawMm, address: string, findings: Finding[]) {
  if (raw == null || (typeof raw === "string" && !raw.trim() && raw.length <= 4096)) {
    findings.push(issue("missing", "MISSING_MM", "Укажите значение в мм.", address));
    return null;
  }
  try {
    return normalize(raw, "mm", { field: address }, "mm");
  } catch (e) {
    if (!(e instanceof CoreIssue)) throw e;
    findings.push(issue("error", e.stage === "parse" ? e.code : e.reason, e.message, address));
    return null;
  }
}

// Inputs, gaps and quantized outputs are finite decimals. Rational interpolation
// is rounded to the explicitly requested decimal lattice before calling this.
export function decimalString(q: Q): string {
  let divisor = q.d;
  let places = 0;
  let numerator = q.n;
  while (divisor !== 1n) {
    if (divisor % 10n === 0n) divisor /= 10n;
    else if (divisor % 2n === 0n) { divisor /= 2n; numerator *= 5n; }
    else if (divisor % 5n === 0n) { divisor /= 5n; numerator *= 2n; }
    else throw new RangeError("Expected a terminating decimal");
    places++;
  }
  const digits = (numerator < 0n ? -numerator : numerator).toString().padStart(places + 1, "0");
  const value = places ? digits.slice(0, -places) + "." + digits.slice(-places) : digits;
  return numerator < 0n ? "-" + value : value;
}
export function nearestTick(x: Q): bigint {
  const magnitude = x.n < 0n ? -x.n : x.n;
  const ticks = (2n * magnitude + x.d) / (2n * x.d);
  return x.n < 0n ? -ticks : ticks;
}
export function quantize(x: Q, origin: Q, step: Q): Q {
  const tick = nearestTick(x.sub(origin).div(step));
  return origin.add(step.mul(new Q(tick)));
}
