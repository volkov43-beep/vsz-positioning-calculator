import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculatePosition, demoProfile, type PositionInput, type Request, type Series } from "../../src/core/position";
import { bitPattern, exactBinary, fromBits, rationalBits } from "../../src/core/binary64";
import { compare, Expr, rounded } from "../../src/core/expression";
import { normalize } from "../../src/core/input";
import { Q, dyadic, isqrt, one } from "../../src/core/rational";
import { series } from "../../src/core/series";

type Side = "up" | "down";
interface Row {
  name: string; unit: "um" | "mm";
  input: {position_id: string; target_mm: string} & Record<Side, {repeat: number; value: string}[]>;
  bits?: Record<string, string>; active?: string[]; failure?: string;
}
const oracle = fileURLToPath(new URL("./position_oracle.py", import.meta.url));
const records: Row[] = JSON.parse(execFileSync("python", ["-B", oracle], {encoding: "utf8", maxBuffer: 4*1024*1024}));
const addr = {positionId: "p", field: "test"};
const directions = ["up", "down"] as const;
const names: Record<keyof Series<number>, string> = {
  mean: "mean", variance: "variance", sd: "sd", twoSd: "twoSd", range: "range", lower: "lower",
  upper: "upper", repeatability: "R_i",
};

function request(position: PositionInput): Request {
  return { profile: demoProfile, position, runId: "run-1", trialId: "synthetic", inputRevision: 1,
    inputDigest: createHash("sha256").update(JSON.stringify(position)).digest("hex") };
}

function fixture(row: Row): PositionInput {
  function observations(side: Side) {
    return row.input[side].map(o => ({repeat: o.repeat, raw: o.value, sourceUnit: row.unit}));
  }
  return {positionId: row.input.position_id, targetMm: row.input.target_mm,
    observations: {up: observations("up"), down: observations("down")} };
}
const bits = (x: number) => bitPattern(x).toString(16).padStart(16, "0");
function blank() { return fixture(records.find(row => row.name === "T01-zero/p01")!); }

function diagnostic(result: ReturnType<typeof calculatePosition>) {
  if (result.state === "research-computed") throw Error("Expected blocked attempt");
  return result.errors[0];
}

function succeeded(result: ReturnType<typeof calculatePosition>) {
  if (result.state !== "research-computed") throw Error(JSON.stringify(result.errors));
  return result;
}

describe("independent Python certificates over represented observations", () => {
  it("covers the v1 positive corpus, REV06 witnesses and the near tie", () => {
    expect(new Set(records.map(r => r.name)).size).toBe(306);
    expect(new Set(records.map(r => r.name.split("/")[0])).size).toBe(38);
    expect(records.filter(r => !r.failure)).toHaveLength(296);
    expect(records.filter(r => r.failure === "input-collision")).toHaveLength(5);
    expect(records.filter(r => r.failure === "derived-nonzero-to-zero")).toHaveLength(5);
  });
  it.each(records)("$name", row => {
    const result = calculatePosition(request(fixture(row)));
    if (row.failure) {
      expect(result.state).toBe("failed");
      expect(diagnostic(result)).toMatchObject({code: "PRECISION_LOSS", reason: row.failure});
      expect(result).not.toHaveProperty("position");
      return;
    }
    expect(result.state).toBe("research-computed");
    if (result.state !== "research-computed") throw new Error(JSON.stringify(result.errors));
    const p = result.position;
    const observed: Record<string, string> = { mean_both: bits(p.meanBoth), B_i: bits(p.reversal),
      C_i: bits(p.crossCandidate), R_i: bits(p.repeatabilityBoth) };
    for (const side of directions) {
      for (const k of Object.keys(names) as (keyof Series<number>)[]) observed[names[k]+"_"+side] = bits(p[side][k]);
      const xs = result.representedInputs[side].map(t => t.b);
      const mean = result.protectedPosition[side].mean.base;
      const squared = xs.map(x => x.sub(mean)).map(x => x.mul(x));
      const centeredVariance = squared.reduce((a,b) => a.add(b)).div(new Q(4n));
      expect(result.protectedPosition[side].variance.base.cmp(centeredVariance)).toBe(0);
    }
    expect(observed).toEqual(row.bits);
    expect(p.activeCandidates).toEqual(row.active);
    expect(result).toMatchObject({executionPurpose: "research-demo", budgetStatus: "budget-not-approved",
      methodStatus: "proposed", productionEligible: false});
  });
});

describe("regressions visible at the position boundary", () => {
  function computed(id: string) {
    const result = calculatePosition(request(fixture(records.find(r => r.name === id)!)));
    if (result.state !== "research-computed") throw Error(id);
    return result.position;
  }
  it("keeps local scatter destroyed by subtracting another position's origin", () => {
    const p = computed("P02-mixed-scale/p02");
    expect((p.up.sd + 1e6) - 1e6).toBe(0);
    expect(p.up.sd).toBeGreaterThan(0);
  });
  it("preserves the mean residual and signed reversal", () => {
    const p = computed("REV06-within-series-mean-loss/p01");
    expect(p.up.mean - p.down.mean).toBe(0);
    expect(p.reversal).toBeGreaterThan(0);
    expect(computed("T04-negative-reversal/p01").reversal).toBeLessThan(0);
  });
  it("rejects a rounded square as variance", () => {
    const p = computed("T06-single-outlier/p03");
    expect(p.up.variance).toBe(80);
    expect(p.up.sd ** 2).not.toBe(p.up.variance);
  });
  it("rejects a tie inferred from identical public repeatabilities", () => {
    const p = computed("near-repeatability/p01");
    expect([p.crossCandidate, p.up.repeatability, p.down.repeatability]).toEqual([4, 4, 4]);
    expect(p.activeCandidates).toEqual(["cross"]);
  });
  it("retains all exact winners in contract order", () => {
    expect(computed("T01-zero/p01").activeCandidates).toEqual(["cross", "up", "down"]);
  });
});

describe("exact input conversion and failure isolation", () => {
  it("normalizes mm once and preserves the decimal source and exact binary error", () => {
    const t = normalize(" +0,0000300 ", "mm", addr);
    expect(t.binary64).toBe(0.03);
    expect(Number("0.00003") * 1000).not.toBe(t.binary64);
    expect(t.normalized).toBe("0.03");
    expect(t.exactDecimal.toString()).toBe("3/100000");
    expect(t.b.toString()).toBe("1080863910568919/36028797018963968");
    expect(t.b.sub(t.d).cmp(t.error)).toBe(0);
    expect(t.raw).toBe(" +0,0000300 ");
  });
  it("keeps original negative zero, units and exponential syntax", () => {
    const z = normalize("−0,00e+3", "um", addr);
    expect(z.raw).toBe("−0,00e+3");
    expect(bits(z.binary64)).toBe("0000000000000000");
    expect(normalize(" −2,50E-3 ", "mm", addr).normalized).toBe("-2.5");
    expect(normalize("5e-324", "um", addr).binary64).toBe(Number.MIN_VALUE);
  });
  it.each([
    [null, "OBS_MISSING"], ["", "OBS_EMPTY"], ["  ", "OBS_WHITESPACE"], ["1,0.0", "OBS_MALFORMED"], ["NaN", "OBS_NAN"],
    ["+Infinity", "OBS_INFINITY"], [false, "OBS_TYPE"], ["1e309", "input-nonfinite"],
    ["-1e-400", "input-nonzero-to-zero"], ["1e9000", "decimal-resource-limit"],
  ])("rejects %j", (raw, reason) => {
    const p = blank(); p.observations.down[2].raw = raw as string;
    const req = request(p), r = calculatePosition(req);
    expect(diagnostic(r)).toMatchObject({reason, runId: req.runId, field: {positionId: p.positionId, direction: "down", repeat: 3}});
    expect(r.inputSnapshot.position).toEqual(p);
    expect(r.key.inputDigest).toBe(req.inputDigest);
    expect(r).not.toHaveProperty("protectedPosition");
    expect(r).not.toHaveProperty("position");
  });
  it("checks the public coordinate separately from the twenty calculated fields", () => {
    const p = blank(); p.targetMm = "5e-324";
    expect(diagnostic(calculatePosition(request(p)))).toMatchObject({
      reason: "output-subnormal", field: {field: "targetMm"},
    });
  });
  it("rejects unknown units, repetitions and unsupported purpose", () => {
    const p = blank();
    p.observations.up[0].sourceUnit = "counts" as "um";
    expect(diagnostic(calculatePosition(request(p))).code).toBe("UNIT_UNKNOWN");
    p.observations.up[0].sourceUnit = "um";
    p.observations.up[0].repeat = 2;
    expect(diagnostic(calculatePosition(request(p))).code).toBe("REPEAT_DUP");
    expect(Object.isFrozen(demoProfile)).toBe(true);
    const req = request(blank());
    req.profile = {...demoProfile, executionPurpose: "production" as "research-demo"};
    expect(diagnostic(calculatePosition(req)).code).toBe("PROFILE_UNSUPPORTED");
  });
  it("refuses short series before arithmetic and preserves an isolated snapshot", () => {
    const p = blank();
    p.observations.up = p.observations.up.slice(1);
    const r = calculatePosition(request(p));
    expect(r.state).toBe("notStarted");
    expect(diagnostic(r).code).toBe("SERIES_SHORT");
    p.observations.up[0].raw = "9";
    expect(r.inputSnapshot.position.observations.up[0].raw).toBe("0");
  });
  it("finds collisions across directions and accepts equivalent decimal spellings", () => {
    const p = blank();
    p.observations.down[2].raw = "1.00000000000000001";
    p.observations.up[3].raw = "1";
    const failed = calculatePosition(request(p));
    expect(diagnostic(failed)).toMatchObject({reason: "input-collision", field: {direction: "down", repeat: 3},
      evidence: {first: {direction: "up", repeat: 4}}});
    p.observations.down[2].raw = "+1,00";
    expect(calculatePosition(request(p)).state).toBe("research-computed");
  });
  it("keeps repeat numbers independent of array order", () => {
    const row = records.find(r => r.name === "T06-single-outlier/p03")!;
    const p = fixture(row);
    const before = calculatePosition(request(p));
    p.observations.up = [...p.observations.up].reverse();
    const after = calculatePosition(request(p));
    expect(succeeded(after).position).toEqual(succeeded(before).position);
    expect(succeeded(after).representedInputs.up.map(t => t.address.repeat)).toEqual([1,2,3,4,5]);
  });
});

describe("RN64 boundaries and finite certification", () => {
  const fromQ = (q: Q) => rounded(new Expr(q), addr);
  it("ties to even at both parities and preserves exact +0", () => {
    const half = dyadic(1n,-53);
    expect(fromQ(one.add(half))).toBe(1);
    expect(bits(fromQ(one.add(half.mul(new Q(3n)))))).toBe("3ff0000000000002");
    expect(bits(fromQ(one.add(half).neg()))).toBe("bff0000000000000");
    expect(bits(rounded(Expr.root(new Q(20n)).sub(Expr.root(new Q(5n)).scale(new Q(2n))),addr))).toBe("0000000000000000");
  });
  it("accepts minimum normal, rejects subnormal, vanished nonzero and overflow", () => {
    expect(fromQ(dyadic(1n,-1022))).toBe(2**-1022);
    expect(() => fromQ(dyadic(1n,-1074))).toThrowError(expect.objectContaining({reason:"output-subnormal"}));
    expect(() => fromQ(dyadic(-1n,-1075))).toThrowError(expect.objectContaining({reason:"output-nonzero-to-zero"}));
    const threshold = dyadic(1n,1024).sub(dyadic(1n,970));
    expect(() => fromQ(threshold)).toThrowError(expect.objectContaining({reason:"output-overflow"}));
    expect(fromQ(threshold.sub(one))).toBe(Number.MAX_VALUE);
  });
  it("refuses a whole position when a valid s has an unsupported variance", () => {
    const p = blank(); p.observations.up[4].raw = String(2**-600);
    const r = calculatePosition(request(p));
    expect(diagnostic(r)).toMatchObject({reason:"output-nonzero-to-zero", field:{field:"variance",direction:"up"}});
    expect(r).not.toHaveProperty("position");
    expect(rounded(series([0,0,0,0,2**-600].map(exactBinary)).sd,addr)).toBe(2**-600/Math.sqrt(5));
  });
  it("keeps admissible v when a binary64 intermediate square overflows", () => {
    const v = series([0,0,0,0,2**512].map(exactBinary)).variance;
    expect((2**512)**2).toBe(Infinity);
    expect(bits(rounded(v,addr))).toBe(bits(fromBits(rationalBits(dyadic(1n,1024).div(new Q(5n))))));
  });
  it("fails the entire attempt when the exact branch order needs more than 1024 bits", () => {
    const p = blank();
    for (const side of directions) {
      p.observations[side] = ["-1", "-1", "0", "1", "1"].map((raw,j) => ({raw,repeat:j+1,sourceUnit:"um"}));
    }
    p.observations.down[2].raw = String(2 ** -1050);
    const result = calculatePosition(request(p));
    expect(diagnostic(result)).toMatchObject({code:"PRECISION_LOSS", reason:"certificate-resource-limit",
      field:{field:"activeCandidates"}, evidence:{operation:"order"}});
    expect(result).not.toHaveProperty("position");
  });
  it.each([180,350,700,1300])("orders sqrt(2) against a %i-bit lower bound or signals exhaustion", k => {
    const floor = dyadic(isqrt(2n << BigInt(2*k)),-k);
    const a = Expr.root(new Q(2n)), b = new Expr(floor);
    expect(floor.mul(floor).cmp(new Q(2n))).toBe(-1);
    if (k < 1024) expect(compare(a,b,addr)).toBe(1);
    else {
      expect(() => compare(a,b,addr)).toThrowError(expect.objectContaining({reason:"certificate-resource-limit"}));
      const midpoint = new Expr(one.add(dyadic(1n,-53)));
      expect(() => rounded(midpoint.add(a.sub(b)),addr)).toThrowError(expect.objectContaining({stage:"resource"}));
    }
  });
});
