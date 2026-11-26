import type { AxisInputs, AxisRequest } from "../core/axis";
import type { PositionInput } from "../core/contracts";
import { hasEnteredObservations, sameTarget } from "../planning/changes";
import { normalize } from "../core/input";
import { snapshotDigest } from "../core/snapshot";
import { algorithmVersion, type ActiveTrial, type Approach, type Passport, type PlanRequest, type Proposal, type Receipt } from "../planning";

export function emptyPlanForm() {
  const approach = (): Approach => ({ bothSides: "unknown", availableMm: null, requiredMm: null, basis: null });
  return {
    example: false, source: "", confirmed: false, system: "", positive: "",
    min: "", max: "", start: "", end: "", left: "", right: "", count: "",
    choice: "unknown" as PlanRequest["section"]["choice"], constraint: "",
    gridOrigin: "", gridStep: "", places: "3", leftApproach: approach(), rightApproach: approach(),
  };
}
export type PlanForm = ReturnType<typeof emptyPlanForm>;
export function teachingForm(): PlanForm {
  return { ...emptyPlanForm(), example: true, source: "Учебный пример MEETING-01", confirmed: true, system: "Учебная X",
    positive: "Вправо", min: "0", max: "1000", start: "40", end: "960", left: "40.000", right: "960.000", choice: "free" };
}
export interface PlanSession {
  form: PlanForm;
  serial: number;
  manualForm?: PlanForm;
  accepted?: Proposal;
  frame: ActiveTrial["frame"];
  receipt?: Receipt;
}
export const freshSession = (): PlanSession => ({ form: emptyPlanForm(), serial: 1, frame: null });

export function passport(axis: AxisRequest["inputs"]["axis"], f: PlanForm): Passport {
  return { name: f.example ? "X" : axis.name, kind: "linear", fullTravelMm: f.example ? "1000" : axis.fullTravelMm,
    travelConfirmed: f.confirmed, travelSource: f.source || null,
    frame: { system: f.system, positiveDirection: f.positive },
    limits: f.min || f.max ? { minMm: f.min || null, maxMm: f.max || null } : null };
}
export function activeTrial(req: AxisRequest, session: PlanSession): ActiveTrial {
  return { trialId: req.trialId, inputs: req.inputs, inputRevision: req.inputRevision, conditionsVersion: String(session.serial),
    frame: session.frame, ...(session.receipt && { lastApplied: session.receipt }) };
}
export async function planRequest(active: ActiveTrial, f: PlanForm): Promise<PlanRequest> {
  const end = (rawMm: string) => ({ rawMm: rawMm || null, status: "preliminary" as const,
    basis: rawMm ? (f.example ? "Учебный план" : "Цель указана инженером") : null });
  return {
    base: { trialId: active.trialId, inputRevision: active.inputRevision, inputDigest: await snapshotDigest(active.inputs),
      conditionsVersion: active.conditionsVersion }, passport: passport(active.inputs.axis, f),
    section: { startMm: f.start || null, endMm: f.end || null, source: f.start && f.end ? (f.example ? "Учебный участок" : "Введено инженером") : null,
      choice: f.choice, constraints: f.constraint.trim() ? [f.constraint] : [], approach: { left: f.leftApproach, right: f.rightApproach } },
    ends: { left: end(f.left), right: end(f.right) },
    grid: f.gridOrigin || f.gridStep ? { originMm: f.gridOrigin || null, stepMm: f.gridStep || null, rounding: "nearest-ties-away-from-origin" } : null,
    desiredCount: f.count === "" ? "recommended" : integer(f.count),
    algorithmVersion, decimalPlaces: integer(f.places),
    previousTargets: { axisName: active.inputs.axis.name, frame: active.frame,
      positions: active.inputs.positions.map(({ positionId, targetMm }) => ({ positionId, targetMm })) },
  };
}
function integer(raw: string) {
  return /^\d+$/.test(raw.trim()) ? Number(raw) : -1;
}
export const protectionMessage = "Предложенный план затрагивает уже введённые измерения. Замена заблокирована для защиты исходных данных. Отмените изменение или сохраните исходное испытание способом, который поддерживает восстановление.";
export type CommitPlan = (active: ActiveTrial, plan: Proposal, wanted: () => boolean) => Promise<"applied" | "conditions" | "conflict" | "protected" | "blocked" | "already">;

export interface PositionEditBlock {
  positionId: string;
  reason: "remove" | "target";
}

// Compare against the live source, even if the candidate also clears observations.
export function blockedPositionEdit(previous: AxisInputs, next: AxisInputs): PositionEditBlock | null {
  if (previous.positions === next.positions) return null;
  // A null entry means this ID would refer to multiple targets in the candidate.
  const byId = new Map<string, PositionInput | null>();
  for (const row of next.positions)
    byId.set(row.positionId, byId.has(row.positionId) ? null : row);
  for (const old of previous.positions) {
    const row = byId.get(old.positionId);
    if (row === old || !hasEnteredObservations(old)) continue;
    if (row === undefined) return { positionId: old.positionId, reason: "remove" };
    if (row === null || (row.targetMm !== old.targetMm && !sameTarget(old.targetMm, row.targetMm)))
      return { positionId: old.positionId, reason: "target" };
  }
  return null;
}

export function teachingAxisMismatch(axis: AxisRequest["inputs"]["axis"], plan: Proposal, teaching: boolean) {
  if (axis.name !== plan.request.passport.name) return true;
  if (!teaching || !axis.fullTravelMm?.trim()) return false;
  try { return normalize(axis.fullTravelMm, "mm", { field: "fullTravelMm" }, "mm").normalized !== "1000"; }
  catch { return true; }
}

export function guardCurrent(live: AxisRequest | null, session: PlanSession, captured: ActiveTrial,
  guard: PlanRequest["base"]) {
  // prepareApply computed guard.inputDigest for captured.inputs; each accepted write replaces that object.
  return !!live && live.trialId === guard.trialId && live.inputRevision === guard.inputRevision
    && live.inputs === captured.inputs && String(session.serial) === guard.conditionsVersion;
}
