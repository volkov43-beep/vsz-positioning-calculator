import type { Series } from "./contracts";
import { Expr } from "./expression";
import { Q, zero } from "./rational";

/** Values are exact rational images of the five represented observations. */
export function series(values: readonly Q[]): Series<Expr> {
  if (values.length !== 5) throw new RangeError("Expected five observations");
  let sum = zero, pairSquares = zero;
  let min = values[0], max = values[0];
  for (const [j, x] of values.entries()) {
    sum = sum.add(x);
    if (x.cmp(min) < 0) min = x;
    if (x.cmp(max) > 0) max = x;
    for (let k = 0; k < j; k++) {
      const delta = x.sub(values[k]);
      pairSquares = pairSquares.add(delta.mul(delta));
    }
  }
  const mean = new Expr(sum.div(new Q(5n)));
  const variance = pairSquares.div(new Q(20n));
  const sd = Expr.root(variance);
  const twoSd = sd.scale(new Q(2n));
  return { mean, variance: new Expr(variance), sd, twoSd, lower: mean.sub(twoSd), upper: mean.add(twoSd),
    range: new Expr(max.sub(min)), repeatability: twoSd.scale(new Q(2n)) };
}
