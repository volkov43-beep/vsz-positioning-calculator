import type { Position } from "./contracts";
import type { Direction } from "./diagnostics";
import { compare, Expr } from "./expression";
import { Q, zero } from "./rational";

export const axisFields = [
  "A",
  "A_up",
  "A_down",
  "E",
  "E_up",
  "E_down",
  "M",
  "R",
  "R_up",
  "R_down",
  "B",
  "Bbar",
] as const;
export type AxisField = (typeof axisFields)[number];
export type AxisValues<T> = Record<AxisField, T>;
type Family = "lower_min" | "upper_max" | "mean_min" | "mean_max";
export type Extremum =
  | Family
  | `${Family}_${Direction}`
  | "mean_both_min"
  | "mean_both_max"
  | "R_max"
  | "R_up_max"
  | "R_down_max"
  | "B_abs_max";

export interface Source {
  positionId: string;
  direction: Direction | "both";
  kind: Extremum;
  /** Zero-based position index in this input revision, independent of display order. */
  positionOrder: number;
}

type Winner = { value: Expr; sources: Source[] };
export type Located = { positionId: string; value: Position<Expr> };

export function aggregate(rows: readonly Located[]) {
  if (!rows.length) throw new RangeError("Axis needs at least one position");
  const winners = new Map<Extremum, Winner>();
  let reversalSum = zero;
  function pick(
    kind: Extremum,
    value: Expr,
    positionId: string,
    positionOrder: number,
    direction: Source["direction"],
  ) {
    const current = winners.get(kind);
    const order = current ? compare(value, current.value, { field: kind, positionId }) : 0;
    const source = { kind, positionId, direction, positionOrder };
    if (!current || (kind.includes("_min") ? order < 0 : order > 0))
      winners.set(kind, { value, sources: [source] });
    else if (order === 0) current.sources.push(source);
  }

  for (const [order, { positionId, value: p }] of rows.entries()) {
    for (const direction of ["up", "down"] as const) {
      const s = p[direction];
      for (const suffix of ["", `_${direction}`] as const) {
        pick(`lower_min${suffix}`, s.lower, positionId, order, direction);
        pick(`upper_max${suffix}`, s.upper, positionId, order, direction);
        pick(`mean_min${suffix}`, s.mean, positionId, order, direction);
        pick(`mean_max${suffix}`, s.mean, positionId, order, direction);
      }
      pick(`R_${direction}_max`, s.repeatability, positionId, order, direction);
    }
    pick("mean_both_min", p.meanBoth, positionId, order, "both");
    pick("mean_both_max", p.meanBoth, positionId, order, "both");
    pick("R_max", p.repeatabilityBoth, positionId, order, "both");
    pick("B_abs_max", new Expr(p.reversal.base.abs()), positionId, order, "both");
    reversalSum = reversalSum.add(p.reversal.base);
  }
  const best = (kind: Extremum) => winners.get(kind)!.value;
  const span = (hi: Extremum, lo: Extremum) => best(hi).sub(best(lo));
  const exact: AxisValues<Expr> = {
    A: span("upper_max", "lower_min"),
    A_up: span("upper_max_up", "lower_min_up"),
    A_down: span("upper_max_down", "lower_min_down"),
    E: span("mean_max", "mean_min"),
    E_up: span("mean_max_up", "mean_min_up"),
    E_down: span("mean_max_down", "mean_min_down"),
    M: span("mean_both_max", "mean_both_min"),
    R: best("R_max"),
    R_up: best("R_up_max"),
    R_down: best("R_down_max"),
    B: best("B_abs_max"),
    Bbar: new Expr(reversalSum.div(new Q(BigInt(rows.length)))),
  };
  const extrema = Object.fromEntries(
    Array.from(winners, ([kind, winner]) => [kind, winner.sources]),
  ) as Record<Extremum, Source[]>;
  return { exact, extrema };
}
