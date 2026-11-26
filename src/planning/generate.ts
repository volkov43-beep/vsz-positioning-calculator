import { Q, zero } from "../core/rational";
import { decimalString, quantize } from "./decimal";
import type { Geometry } from "./geometry";
import { issue, type Finding, type PlanRequest, type PlanRow } from "./types";

export function generate(r: PlanRequest, g: Geometry, findings: Finding[]): PlanRow[] {
  if (r.section.choice !== "free") {
    findings.push(issue("missing", "EXPLICIT_TARGETS", "Для фиксированного или неизвестного размещения укажите цели вручную.", "section.choice", "positions"));
    return [];
  }
  const count = r.desiredCount === "recommended" ? g.recommendation.minimum : r.desiredCount;
  if (findings.length || !g.left || !g.right || !count || !g.recommendation.minimum) return [];
  if (count < g.recommendation.minimum) {
    findings.push(issue("error", "REQUEST_BELOW_MINIMUM", "Запрошено меньше позиций, чем рекомендует правило плотности.", "desiredCount"));
    return [];
  }
  const weights = Array.from({ length: count - 1 }, (_, i) => 2 + i % 3);
  const total = BigInt(weights.reduce((a, b) => a + b, 0));
  const span = g.right.sub(g.left);
  const unit = new Q(1n, 10n ** BigInt(r.decimalPlaces));
  let cumulative = 0n;
  return Array.from({ length: count }, (_, i) => {
    let rawMm: string;
    if (i === 0) rawMm = r.ends.left.rawMm!;
    else if (i === count - 1) rawMm = r.ends.right.rawMm!;
    else {
      cumulative += BigInt(weights[i - 1]);
      const interpolated = g.left!.add(span.mul(new Q(cumulative, total)));
      rawMm = decimalString(quantize(interpolated, zero, unit));
    }
    return { positionId: "plan-" + (i + 1), rawMm, origin: "proposed" };
  });
}
