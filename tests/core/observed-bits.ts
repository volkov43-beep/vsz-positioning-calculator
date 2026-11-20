import type { Position, Series } from "../../src/core/contracts";

export function bits(n: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleBE(n);
  return buffer.toString("hex");
}

const seriesNames: Record<keyof Series<number>, string> = {
  mean: "mean",
  variance: "variance",
  sd: "sd",
  twoSd: "twoSd",
  range: "range",
  lower: "lower",
  upper: "upper",
  repeatability: "R_i",
};

export function positionBits(p: Position<number>): Record<string, string> {
  const numbers: Record<string, string> = {
    mean_both: bits(p.meanBoth),
    B_i: bits(p.reversal),
    C_i: bits(p.crossCandidate),
    R_i: bits(p.repeatabilityBoth),
  };
  for (const dir of ["up", "down"] as const)
    for (const field of Object.keys(seriesNames) as (keyof Series<number>)[])
      numbers[seriesNames[field] + "_" + dir] = bits(p[dir][field]);
  return numbers;
}
