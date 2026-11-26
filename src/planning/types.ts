export const algorithmVersion = "weighted-decimal-1" as const;
export const densityRule = "full-travel-ceil-1" as const;
export const maxPositions = 2048; // Computational bound of this planner version.
export type RawMm = string | null;
export type End = "left" | "right";

export interface Frame {
  system: string;
  positiveDirection: string;
}
export interface Passport {
  name: string;
  kind: string;
  fullTravelMm: RawMm;
  travelSource: string | null;
  travelConfirmed: boolean;
  frame: Frame | null;
  limits: { minMm: RawMm; maxMm: RawMm } | null;
}
export interface Approach {
  bothSides: "unknown" | "possible" | "impossible";
  availableMm: RawMm;
  requiredMm: RawMm;
  basis: string | null;
}
export interface Section {
  startMm: RawMm;
  endMm: RawMm;
  source: string | null;
  choice: "free" | "fixed" | "unknown";
  constraints: string[];
  approach: Record<End, Approach>;
}
export interface Target {
  rawMm: RawMm;
  basis: string | null;
  status: "preliminary" | "agreed";
}
export interface PlanBase {
  trialId: string;
  inputRevision: number;
  inputDigest: string;
  conditionsVersion: string;
}
export interface PlanRequest {
  base: PlanBase;
  passport: Passport;
  section: Section;
  ends: Record<End, Target>;
  grid: { originMm: RawMm; stepMm: RawMm; rounding: "nearest-ties-away-from-origin" } | null;
  /** Optional ID-only snapshot of the active trial, without observations. */
  previousTargets?: { axisName: string; frame: Frame | null; positions: { positionId: string; targetMm: string }[] };
  desiredCount: number | "recommended";
  algorithmVersion: string;
  decimalPlaces: number;
}
export interface PlanRow {
  positionId: string;
  rawMm: string;
  origin: "manual" | "proposed" | "edited-proposal";
  originalProposalMm?: string;
}
export interface ExecutableRow extends PlanRow {
  order: number;
  executableMm: string | null;
}

export interface Explanation {
  code: string;
  message: string;
  addresses: string[];
}
export type Finding = Explanation & { level: "missing" | "error" | "warning" };
export type Status<T extends string> = Explanation & { state: T };
export type Rule = Status<"passed" | "violated" | "unknown" | "not-applicable">;
export type Review = {
  proposalVersion: string;
  conditions: string[];
  decision: "confirmed-listed" | "rejected";
  basis: string;
};
export function status<T extends string>(state: T, code: string, message: string, ...addresses: string[]): Status<T> {
  return { state, code, message, addresses };
}
export function issue(level: Finding["level"], code: string, message: string, ...addresses: string[]): Finding {
  return { level, code, message, addresses };
}


/** Strip derived display/order/grid fields when a validated row is edited again. */
export function sourceRow(row: PlanRow): PlanRow {
  const { positionId, rawMm, origin, originalProposalMm } = row;
  return originalProposalMm === undefined ? { positionId, rawMm, origin }
    : { positionId, rawMm, origin, originalProposalMm };
}

export function editCoordinate(row: PlanRow, rawMm: string): PlanRow {
  const original = sourceRow(row);
  if (rawMm === original.rawMm || original.origin === "manual") return { ...original, rawMm };
  return { positionId: row.positionId, rawMm, origin: "edited-proposal", originalProposalMm: original.originalProposalMm ?? original.rawMm };
}
