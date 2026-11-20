import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculateAxis, demoProfile, isCurrentAxisResult, type AxisResult } from "../../src/core/axis";
import { bits, positionBits } from "./observed-bits";
import type { AxisField, Extremum } from "../../src/core/aggregate";
import { snapshotDigest } from "../../src/core/snapshot";
import { fixtureRequest, type Fixture } from "./fixture-input";

interface Numeric {
  fixture: Fixture;
  level?: undefined;
  representedPositions: Fixture["positions"];
  failure: string | null;
  changedAxisFields: string[];
  changedObservations: number;
  positions: Record<string, { fields: Record<string, string>; branches: string[] }>;
  totals: Record<AxisField, string>;
  sources: Record<Extremum, { position_id: string; direction: string }[]>;
}
interface Invalid {
  fixture: Fixture;
  level: string;
}
const file = fileURLToPath(new URL("./axis_oracle.py", import.meta.url));
const all: (Numeric | Invalid)[] = JSON.parse(
  execFileSync("python", ["-B", file], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }),
);
const numeric = all.filter((c): c is Numeric => !c.level);
const invalid = all.filter((c): c is Invalid => !!c.level);
const get = (id: string) => numeric.find((c) => c.fixture.case_id === id)!;
const request = (c: { fixture: Fixture }) => fixtureRequest(c.fixture, demoProfile);

function succeeded(result: AxisResult) {
  if (result.state !== "research-computed") throw Error(JSON.stringify(result.errors));
  return result;
}
function blocked(result: AxisResult) {
  if (result.state === "research-computed") throw Error("Expected a blocked attempt");
  for (const field of ["positions", "axis", "extrema"]) expect(result).not.toHaveProperty(field);
  expect(result.errors[0].runId).toBe(result.key.runId);
  return result.errors[0];
}
function verify(result: ReturnType<typeof succeeded>, ref: Numeric) {
  const { positions, axis, extrema } = result;
  expect(Object.fromEntries(Object.entries(axis).map(([k, v]) => [k, bits(v)]))).toEqual(ref.totals);
  const order = ref.fixture.positions.map((p) => p.position_id);
  expect(positions.map((p) => p.positionId)).toEqual(order);
  for (const p of positions) {
    expect(positionBits(p)).toEqual(ref.positions[p.positionId].fields);
    const aliases: Record<string, string> = { cross: "C_i", up: "R_i_up", down: "R_i_down" };
    expect(p.activeCandidates.map((x) => aliases[x])).toEqual(ref.positions[p.positionId].branches);
  }
  expect(Object.keys(extrema).sort()).toEqual(Object.keys(ref.sources).sort());
  for (const kind of Object.keys(ref.sources) as Extremum[]) {
    expect(extrema[kind]).toEqual(
      ref.sources[kind].map((s) => ({
        positionId: s.position_id,
        direction: s.direction,
        kind,
        positionOrder: order.indexOf(s.position_id),
      })),
    );
  }
  expect(result.units).toEqual({ axis: "um", coordinate: "mm", deviation: "um", variance: "um2" });
}

describe("independent axis certificates", () => {
  it("covers the full immutable manifest and the separate witnesses", () => {
    expect(numeric.filter((c) => "category" in c.fixture)).toHaveLength(32);
    expect(invalid).toHaveLength(21);
    expect(numeric).toHaveLength(40);
  });
  it.each(numeric)("layer 2 on exact representations of $fixture.case_id", async (c) => {
    // A distinct synthetic input with each observation replaced by the exact decimal expansion of b.
    const req = fixtureRequest(
      { ...c.fixture, units: { coordinate: "mm", deviation: "um" }, positions: c.representedPositions },
      demoProfile,
    );
    const r = succeeded(await calculateAxis(req));
    expect(r.representation).toEqual({ changedObservations: 0, changedAxisFields: [] });
    verify(r, c);
  });
  it.each(numeric)("actual decimal snapshot and issuance for $fixture.case_id", async (c) => {
    const req = request(c),
      r = await calculateAxis(req);
    expect(r.inputSnapshot).toEqual(req.inputs);
    expect(r).toMatchObject({
      executionPurpose: "research-demo",
      productionEligible: false,
      budgetStatus: "budget-not-approved",
    });
    if (c.failure) {
      expect(blocked(r)).toMatchObject({ code: "PRECISION_LOSS", reason: c.failure });
      return;
    }
    const success = succeeded(r);
    verify(success, c);
    expect(success.representation.changedObservations).toBe(c.changedObservations);
    expect([...success.representation.changedAxisFields].sort()).toEqual(c.changedAxisFields);
  });
});

const errorCodes: Record<string, string> = {
  "N01-missing-observation-value": "OBS_MISSING",
  "N02-blank-string": "OBS_WHITESPACE",
  "N02-empty-string": "OBS_EMPTY",
  "N02-malformed": "OBS_MALFORMED",
  "N03-four-repeats": "SERIES_SHORT",
  "N03-six-repeats": "SERIES_LONG",
  "N04-ambiguous-direction": "DIRECTION_UNKNOWN",
  "N04-missing-direction": "DIRECTION_MISSING",
  "N05-ambiguous-unit": "UNIT_AMBIGUOUS",
  "N05-unknown-unit": "UNIT_UNKNOWN",
  "N06-duplicate-coordinate": "COORD_DUP",
  "N06-duplicate-position-id": "POSITION_ID_DUP",
  "N06-duplicate-repeat": "REPEAT_DUP",
  "N07-no-positions": "AXIS_EMPTY",
  "N08-boolean": "OBS_TYPE",
  "N08-infinity": "OBS_INFINITY",
  "N08-nan": "OBS_NAN",
  "N08-non-numeric": "OBS_TEXT",
};
describe("independent states for N01–N10", () => {
  it.each(invalid)("$fixture.case_id", async (c) => {
    const r = await calculateAxis(request(c));
    if (c.level === "input-error" || c.level === "mathematical-error") {
      const error = blocked(r);
      expect(error.code).toBe(errorCodes[c.fixture.case_id]);
      expect(r.state).toBe(c.level === "input-error" ? "notStarted" : "failed");
      expect(r.inputStatus).toBe(c.level === "input-error" ? "invalid" : "empty");
    } else {
      const s = succeeded(r);
      expect(s.inputStatus).toBe("valid");
      expect(Object.keys(s.axis)).toHaveLength(12);
      if (c.level === "report-warning") {
        expect(s.report).toEqual({
          state: "incomplete",
          missingFields: c.fixture.context.missing_report_fields,
        });
        expect(s.applicability.state).toBe("unconfirmed");
      } else {
        expect(s.applicability.state).toBe("outOfScope");
        expect(s.applicability.issues).toContain(
          c.fixture.case_id.startsWith("N07") ? "PLAN_TOO_SHORT" : "OUTSIDE_TRAVEL_PROFILE",
        );
        expect(s.report.state).toBe("notAssessed");
      }
    }
  });
});

describe("data identity, ordering and the live T06 edit", () => {
  it("recomputes a copy of T06, invalidates revision 1 and emits twelve exact positive zeroes", async () => {
    const ref = get("T06-single-outlier"),
      req = request(ref);
    const original = structuredClone(ref.fixture);
    const first = succeeded(await calculateAxis(req));
    verify(first, ref);
    expect(first.axis.B).toBe(4);
    expect(first.axis.Bbar).toBe(0.8);
    expect(await isCurrentAxisResult(first, req)).toBe(true);
    const change = req.inputs.positions
      .find((p) => p.positionId === "p03")!
      .observations.up.find((o) => o.repeat === 5)!;
    expect(change.raw).toBe("20");
    change.raw = "0";
    expect(await isCurrentAxisResult(first, req)).toBe(false);
    req.inputRevision++;
    req.runId = "t06/2";
    const second = succeeded(await calculateAxis(req));
    expect(second.key.inputDigest).not.toBe(first.key.inputDigest);
    expect(await isCurrentAxisResult(first, req)).toBe(false);
    expect(await isCurrentAxisResult(second, req)).toBe(true);
    expect(Object.values(second.axis).map(bits)).toEqual(Array(12).fill("0000000000000000"));
    expect(ref.fixture).toEqual(original);
    expect(first.inputSnapshot.positions[2].observations.up[4].raw).toBe("20");
    req.runId = "t06/3";
    expect(await isCurrentAxisResult(second, req)).toBe(false);
    req.runId = "t06/2";
    req.inputRevision++;
    expect(await isCurrentAxisResult(second, req)).toBe(false);
  });
  it("binds an in-flight calculation to its original snapshot", async () => {
    const req = request(get("T06-single-outlier"));
    const pending = calculateAxis(req);
    req.inputs.positions[2].observations.up[4].raw = "0";
    const r = succeeded(await pending);
    expect(r.axis.B).toBe(4);
    expect(await isCurrentAxisResult(r, req)).toBe(false);
  });
  it("hashes canonical JSON with stable key order while retaining the original decimal lexeme", async () => {
    const obj = { z: "−0.0", a: ["1", 2] };
    const hash = createHash("sha256").update('{"a":["1",2],"z":"−0.0"}').digest("hex");
    expect(await snapshotDigest(obj)).toBe(hash);
    expect(await snapshotDigest({ a: obj.a, z: obj.z })).toBe(hash);
    expect(await snapshotDigest({ a: obj.a, z: "0" })).not.toBe(hash);
    const req = request(get("T01-zero")),
      r = succeeded(await calculateAxis(req));
    const inFlightCheck = isCurrentAxisResult(r, req);
    req.inputs.positions[0].observations.up[0].raw = "+0.0";
    expect(await inFlightCheck).toBe(false);
    expect(await isCurrentAxisResult(r, req)).toBe(false);
  });
  it("handles 5 → 6 → 12 → 5 positions and keeps ties in the order of the actual snapshot", async () => {
    const base = request(get("T01-zero")),
      first = succeeded(await calculateAxis(base));
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...structuredClone(base.inputs.positions[0]),
      positionId: "id" + i,
      targetMm: String(i),
    }));
    for (const m of [5, 6, 12, 5]) {
      base.inputs.positions = rows.slice(0, m).reverse();
      const r = succeeded(await calculateAxis(base));
      expect(r.axis).toEqual(first.axis);
      expect(r.extrema.R_max.map((x) => x.positionId)).toEqual(
        base.inputs.positions.map((p) => p.positionId),
      );
      expect(r.extrema.mean_max.map((x) => x.direction)).toEqual(
        Array.from({ length: m }, () => ["up", "down"]).flat(),
      );
      // Sorting a display copy cannot affect identifiers, extrema or the run key.
      const display = [...r.positions].sort((a, b) => a.targetMm - b.targetMm);
      expect(display.map((p) => p.positionId)).toEqual(rows.slice(0, m).map((p) => p.positionId));
      expect(r.extrema.R_max.map((x) => x.positionId)).toEqual(display.map((p) => p.positionId).reverse());
      expect(await isCurrentAxisResult(r, base)).toBe(true);
    }
  });
  it("keeps fixture expectations and certificates out of the request", async () => {
    const ref = get("T06-single-outlier");
    const poison = { ...ref.fixture, expected: { axis: { B: 900 } }, exact: { Bbar: -70 } };
    const req = request({ fixture: poison });
    expect(JSON.stringify(req)).not.toMatch(/"expected"|"exact"|900|-70/);
    expect(succeeded(await calculateAxis(req)).axis.B).toBe(4);
  });
});

describe("mutation and failure probes", () => {
  it("detects a directional substitute for a combined span and a sign change of Bbar", async () => {
    const ref = get("T04-negative-reversal"),
      r = succeeded(await calculateAxis(request(ref)));
    expect(r.axis.A).toBeGreaterThan(Math.max(r.axis.A_up, r.axis.A_down));
    expect(r.axis.E).toBeGreaterThan(Math.max(r.axis.E_up, r.axis.E_down));
    for (const changed of [
      { ...r.axis, A: Math.max(r.axis.A_up, r.axis.A_down) },
      { ...r.axis, E: Math.max(r.axis.E_up, r.axis.E_down) },
      { ...r.axis, Bbar: Math.abs(r.axis.Bbar) },
    ])
      expect(() => verify({ ...r, axis: changed }, ref)).toThrow();
  });
  it("detects rounded means, a fabricated tie, and an incorrect source order", async () => {
    const ref = get("REV06-near-extrema-equal-rounded-means"),
      r = succeeded(await calculateAxis(request(ref)));
    expect(new Set(r.positions.map((p) => p.up.mean)).size).toBe(1);
    expect(r.axis.E_up).toBeGreaterThan(0);
    expect(r.extrema.mean_max_up.map((x) => x.positionId)).toEqual(["p02"]);
    expect(() => verify({ ...r, axis: { ...r.axis, E_up: 0 } }, ref)).toThrow();
    const bad = structuredClone(r);
    bad.extrema.mean_max_up.push({ ...bad.extrema.mean_max_up[0], positionId: "p01", positionOrder: 0 });
    expect(() => verify(bad, ref)).toThrow();
    const ties = structuredClone(r);
    ties.extrema.mean_min_up.reverse();
    expect(() => verify(ties, ref)).toThrow();
  });
  it("rejects losing A↓ at mixed scales and a negative zero at exact Bbar cancellation", async () => {
    const dir = get("REV06-direction-scale"),
      r = succeeded(await calculateAxis(request(dir)));
    expect(r.axis.A_down).toBe(4e-12);
    expect(() => verify({ ...r, axis: { ...r.axis, A_down: 0 } }, dir)).toThrow();
    const cancel = get("REV06-Bbar-exact-zero"),
      c = succeeded(await calculateAxis(request(cancel)));
    expect(bits(c.axis.Bbar)).toBe("0000000000000000");
    expect(() => verify({ ...c, axis: { ...c.axis, Bbar: -0 } }, cancel)).toThrow();
  });
  it("blocks an overflowing axis span with individually supported positions", async () => {
    const req = request(get("T01-zero"));
    for (const [i, p] of req.inputs.positions.entries())
      for (const side of ["up", "down"] as const)
        for (const observation of p.observations[side]) observation.raw = i === 0 ? "-1e308" : "1e308";
    const r = await calculateAxis(req);
    expect(blocked(r)).toMatchObject({
      code: "PRECISION_LOSS",
      reason: "output-overflow",
      field: { field: "A" },
    });
    expect(r.inputStatus).toBe("valid");
  });
  it("reports cross-position collision witnesses and an isolated nonzero-to-zero axis mean", async () => {
    const c = blocked(await calculateAxis(request(get("cross-position-collision"))));
    expect(c).toMatchObject({
      reason: "input-collision",
      field: { positionId: "p02" },
      evidence: { first: { positionId: "p01" } },
    });
    const lost = blocked(await calculateAxis(request(get("axis-only-mean-loss"))));
    expect(lost).toMatchObject({
      stage: "representation",
      field: { field: "Bbar" },
      reason: "derived-nonzero-to-zero",
    });
  });
  it("blocks the full axis on input conversion, unsupported output and a certificate limit", async () => {
    for (const [raw, reason] of [
      ["1e-400", "input-nonzero-to-zero"],
      ["1e309", "input-nonfinite"],
      [String(2 ** -600), "output-nonzero-to-zero"],
    ]) {
      const req = request(get("T01-zero"));
      req.inputs.positions[3].observations.down[4].raw = raw;
      expect(blocked(await calculateAxis(req)).reason).toBe(reason);
    }
    const req = request(get("T01-zero"));
    for (const side of ["up", "down"] as const)
      req.inputs.positions[4].observations[side] = ["-1", "-1", "0", "1", "1"].map((raw, i) => ({
        raw,
        sourceUnit: "um",
        repeat: i + 1,
      }));
    req.inputs.positions[4].observations.down[2].raw = String(2 ** -1050);
    expect(blocked(await calculateAxis(req)).reason).toBe("certificate-resource-limit");
  });
  it("checks the entire input for collisions before publishing a positional failure", async () => {
    const req = request(get("T01-zero"));
    req.inputs.positions[0].observations.up[4].raw = String(2 ** -600);
    req.inputs.positions[2].observations.up[0].raw = "1";
    req.inputs.positions[4].observations.down[1].raw = "1.00000000000000001";
    expect(blocked(await calculateAxis(req)).reason).toBe("input-collision");
    req.inputs.positions[4].observations.down[1].raw = "1";
    const r = await calculateAxis(req);
    expect(r.inputStatus).toBe("valid");
    expect(blocked(r).reason).toBe("output-nonzero-to-zero");
  });
  it("rejects duplicate coordinates after exact normalization and distinct coordinates with equal binary bits", async () => {
    const req = request(get("T01-zero"));
    req.inputs.positions[0].targetMm = "1.0";
    req.inputs.positions[1].targetMm = "1,00";
    expect(blocked(await calculateAxis(req)).code).toBe("COORD_DUP");
    req.inputs.positions[1].targetMm = "1.00000000000000001";
    expect(blocked(await calculateAxis(req)).reason).toBe("coordinate-collision");
  });
});
