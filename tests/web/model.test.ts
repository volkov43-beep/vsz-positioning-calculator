import { describe, it, expect } from "vitest";
import fixture from "../fixtures/v1/cases/valid/T06-single-outlier.json";
import { draft, sampleData, displayNumber } from "../../src/web/model";
import { calculateAxis, checkAxisInputs } from "../../src/core/axis";

describe("browser input boundary", () => {
  it("ships only T06 input data, with ID, sign, unit and repeat order", () => {
    expect(Object.keys(sampleData).sort()).toEqual(["fullTravelMm", "positions", "sourceId", "sourceUnit"]);
    expect(sampleData.sourceId).toBe(fixture.case_id);
    expect(sampleData.sourceUnit).toBe(fixture.units.deviation);
    expect(sampleData.fullTravelMm).toBe(fixture.context.full_travel_mm);
    expect(sampleData.positions).toEqual(
      fixture.positions.map((p) => ({
        id: p.position_id,
        targetMm: p.target_mm,
        up: p.up.map((o) => o.value),
        down: p.down.map((o) => o.value),
      })),
    );
    for (const p of fixture.positions)
      for (const d of ["up", "down"] as const) expect(p[d].map((o) => o.repeat)).toEqual([1, 2, 3, 4, 5]);
  });
  it("new, blank and restored working copies are independent", async () => {
    expect(checkAxisInputs(draft(false).inputs).valid).toBe(false);
    const a = draft(true);
    a.inputs.positions[2].observations.up[4].raw = "";
    expect(checkAxisInputs(a.inputs).valid).toBe(false);
    const b = draft(true);
    expect(checkAxisInputs(b.inputs).valid).toBe(true);
    const run = await calculateAxis(b);
    expect(run.state === "research-computed" && run.axis.Bbar).toBe(0.8);
    expect(b.trialId).not.toBe(a.trialId);
  });
  it("formats every finite nonzero value without losing its sign or magnitude", () => {
    for (const n of [-1e-300, 1e-25, 1e-7, 0, 0.8, 3.5555555555555554, Number.MAX_VALUE]) {
      expect(Number(displayNumber(n).replace("−", "-").replace(",", "."))).toBe(n);
    }
  });
});
