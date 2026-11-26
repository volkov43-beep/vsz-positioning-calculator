import { demoProfile, type AxisInputs } from "../../src/core/axis";
import { snapshotDigest } from "../../src/core/snapshot";
import { algorithmVersion, type ActiveTrial, type PlanRequest, type PlanRow } from "../../src/planning";

export function request(): PlanRequest {
  const approach = () => ({ bothSides: "unknown" as const, availableMm: null, requiredMm: null, basis: null });
  return {
    base: { trialId: "synthetic-plan", inputRevision: 1, inputDigest: "0".repeat(64), conditionsVersion: "c1" },
    passport: { name: "X", kind: "linear", fullTravelMm: "1000", travelSource: "учебный паспорт", travelConfirmed: true,
      frame: { system: "учебная X", positiveDirection: "вправо" }, limits: { minMm: "0", maxMm: "1000" } },
    section: { startMm: "40", endMm: "960", source: "учебная программа", choice: "free", constraints: [],
      approach: { left: approach(), right: approach() } },
    ends: { left: { rawMm: "40.000", basis: "учебная цель", status: "preliminary" },
      right: { rawMm: "960.000", basis: "учебная цель", status: "preliminary" } },
    grid: null, desiredCount: "recommended", algorithmVersion, decimalPlaces: 3,
  };
}
export function manual(strings: string[]) {
  const r = request();
  r.passport.limits = null;
  r.section.startMm = "-100";
  r.section.endMm = "200";
  r.ends.left.rawMm = strings[0];
  r.ends.right.rawMm = strings.at(-1)!;
  const rows: PlanRow[] = strings.map((rawMm, i) => ({ positionId: "p" + i, rawMm, origin: "manual" }));
  return { r, rows };
}
export async function trial(positions: AxisInputs["positions"] = []) {
  const r = request();
  const inputs: AxisInputs = { profile: demoProfile, axis: { kind: "linear", name: "X", fullTravelMm: "1000" }, positions };
  r.base.inputDigest = await snapshotDigest(inputs);
  const active: ActiveTrial = { inputs, frame: r.passport.frame, trialId: r.base.trialId, inputRevision: 1, conditionsVersion: "c1" };
  return { r, active };
}
