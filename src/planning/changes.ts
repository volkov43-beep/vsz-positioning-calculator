import type { AxisInputs } from "../core/axis";
import type { Observation, PositionInput } from "../core/contracts";
import { canonicalSnapshot, snapshotDigest } from "../core/snapshot";
import { readMm } from "./decimal";
import { validate, type Proposal } from "./planner";
import { issue, sourceRow, type ExecutableRow, type Frame, type PlanBase } from "./types";

export interface Receipt extends PlanBase {
  proposalVersion: string;
}
export interface ActiveTrial {
  trialId: string;
  inputRevision: number;
  conditionsVersion: string;
  inputs: AxisInputs;
  frame: Frame | null;
  lastApplied?: Receipt;
}
type ChangeKind = "added" | "removed" | "moved" | "reformatted" | "reordered" | "kept" | "frame-changed";
interface Change {
  positionId: string;
  kind: ChangeKind;
  oldMm: string | null;
  newMm: string | null;
  oldOrder: number | null;
  newOrder: number | null;
  observations: (Observation & { direction: "up" | "down" })[];
  requiresPreservation: boolean;
}

function entered(o: Observation) {
  return o.raw !== "" && o.raw !== null;
}

export function hasEnteredObservations(row: PositionInput) {
  return row.observations.up.some(entered) || row.observations.down.some(entered);
}

function observations(row?: PositionInput): Change["observations"] {
  if (!row) return [];
  return (["up", "down"] as const).flatMap(direction => row.observations[direction]
    .filter(entered)
    .map(o => ({ ...o, direction })));
}
export function sameTarget(a: string, b: string) {
  const left = readMm(a, "oldMm", []), right = readMm(b, "newMm", []);
  return !!left && !!right && left.d.cmp(right.d) === 0;
}
function emptyPosition(positionId: string, targetMm: string): PositionInput {
  const series = () => Array.from({ length: 5 }, (_, i) => ({ repeat: i + 1, raw: "", sourceUnit: "um" as const }));
  return { positionId, targetMm, observations: { up: series(), down: series() } };
}

export function previewChanges(active: ActiveTrial, plan: Proposal) {
  const oldRows = active.inputs.positions;
  const oldById = new Map(oldRows.map((row, i) => [row.positionId, { row, order: i + 1 }]));
  const frameSame = !!active.frame && canonicalSnapshot(active.frame) === canonicalSnapshot(plan.request.passport.frame)
    && active.inputs.axis.name === plan.request.passport.name;
  const seen = new Set<string>();
  const changes: Change[] = [];
  function compare(old: PositionInput | undefined, next: ExecutableRow | undefined, oldOrder: number | null) {
    const newMm = next ? next.executableMm ?? next.rawMm : null;
    let kind: ChangeKind;
    if (!old) kind = "added";
    else if (!next) kind = "removed";
    else if (!frameSame) kind = "frame-changed";
    else if (!sameTarget(old.targetMm, newMm!)) kind = "moved";
    else if (old.targetMm !== newMm) kind = "reformatted";
    else if (oldOrder !== next.order) kind = "reordered";
    else kind = "kept";
    const data = observations(old);
    changes.push({ positionId: (old ?? next)!.positionId, kind, oldMm: old?.targetMm ?? null, newMm,
      oldOrder, newOrder: next?.order ?? null, observations: data,
      requiresPreservation: data.length > 0 && (kind === "removed" || kind === "moved" || kind === "frame-changed") });
  }
  for (const next of plan.positions) {
    seen.add(next.positionId);
    const old = oldById.get(next.positionId);
    compare(old?.row, next, old?.order ?? null);
  }
  oldRows.forEach((old, i) => { if (!seen.has(old.positionId)) compare(old, undefined, i + 1); });
  const oldTravel = active.inputs.axis.fullTravelMm, newTravel = plan.request.passport.fullTravelMm;
  return { positions: changes, fullTravel: oldTravel === newTravel ? null : { oldMm: oldTravel, newMm: newTravel } };
}

// Preparation produces a candidate only. The caller must compare the returned guard
// again at the actual commit, including after awaiting preparation.
export async function prepareApply(current: ActiveTrial, proposal: Proposal, expectedVersion: string) {
  const active = structuredClone(current);
  const presentedPositions = canonicalSnapshot(proposal.positions);
  const presentedVersion = proposal.version;
  const plan = await validate(proposal.request, proposal.positions.map(sourceRow), proposal.review ?? undefined);
  const base = plan.request.base;
  const guard: PlanBase = { trialId: active.trialId, inputRevision: active.inputRevision,
    conditionsVersion: active.conditionsVersion, inputDigest: await snapshotDigest(active.inputs) };
  function conflict(message: string, ...addresses: string[]) {
    return { state: "conflict" as const, guard, diagnostic: issue("error", "STALE_PLAN", message, ...addresses) };
  }
  if (plan.version !== expectedVersion || plan.version !== presentedVersion || canonicalSnapshot(plan.positions) !== presentedPositions)
    return conflict("Содержимое или версия предложения изменились.", "version");
  if (active.trialId !== base.trialId || active.conditionsVersion !== base.conditionsVersion)
    return conflict("Испытание или условия изменились.", "base.trialId", "base.conditionsVersion");
  if (plan.state !== "draft")
    return { state: "blocked" as const, guard, findings: plan.findings, rules: plan.rules, profile: plan.profile, engineering: plan.engineering };
  const receipt = { ...guard, proposalVersion: plan.version };
  if (active.lastApplied && canonicalSnapshot(active.lastApplied) === canonicalSnapshot(receipt))
    return { state: "already-applied" as const, guard };
  if (base.inputRevision !== guard.inputRevision || base.inputDigest !== guard.inputDigest)
    return conflict("Изменилась редакция или содержание входов.", "base.inputRevision", "base.inputDigest");
  const old = new Map(active.inputs.positions.map(row => [row.positionId, row]));
  if (old.size !== active.inputs.positions.length)
    return conflict("Повтор ID исходных строк мешает однозначно сопоставить измерения.", "inputs.positions");
  if (active.inputs.axis.kind !== plan.request.passport.kind || active.inputs.axis.name !== plan.request.passport.name)
    return conflict("Предложение относится к другой оси.", "passport");
  const { positions: changes, fullTravel } = previewChanges(active, plan);
  if (changes.some(c => c.requiresPreservation))
    return { state: "requires-preservation" as const, guard, changes, fullTravel };
  const positions = plan.positions.map((row, i) => {
    const targetMm = row.executableMm ?? row.rawMm;
    const source = old.get(row.positionId);
    if (!source || changes[i].kind === "moved" || changes[i].kind === "frame-changed")
      return emptyPosition(row.positionId, targetMm);
    return { ...source, targetMm };
  });
  const inputs = { ...active.inputs, axis: { ...active.inputs.axis, fullTravelMm: plan.request.passport.fullTravelMm }, positions };
  const digest = await snapshotDigest(inputs);
  const changed = digest !== guard.inputDigest;
  const next: Receipt = { ...receipt, inputDigest: digest, inputRevision: guard.inputRevision + (changed ? 1 : 0) };
  return { state: changed ? "ready" as const : "unchanged-inputs" as const, guard, changes, fullTravel, inputs,
    receipt: next, invalidateArithmetic: changed, reassessReport: true as const };
}
