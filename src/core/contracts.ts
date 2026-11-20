import type { Direction } from "./diagnostics";

export const demoProfile = Object.freeze({
  executionPurpose: "research-demo",
  profileId: "gost-27843-2006-linear-axis-le-2000-v1",
  profileVersion: "1",
  sdMethod: "sample-n-minus-1",
  numericalPolicyVersion: "vsz-num-0.2",
} as const);
export const algorithmVersion = "position-demo-1";

export interface Attempt {
  runId: string;
  trialId: string;
  inputRevision: number;
  /** Digest of the enclosing inputs snapshot, supplied by its owner. */
  inputDigest: string;
}

export interface Observation {
  repeat: number;
  raw: string | null;
  sourceUnit: "um" | "mm";
}

export interface PositionInput {
  positionId: string;
  targetMm: string;
  observations: Record<Direction, readonly Observation[]>;
}

export interface Request extends Attempt {
  profile: typeof demoProfile;
  position: PositionInput;
}

export type Branch = "cross" | Direction;

export interface Series<T> {
  mean: T;
  variance: T;
  sd: T;
  twoSd: T;
  lower: T;
  upper: T;
  range: T;
  repeatability: T;
}

export interface Position<T> {
  up: Series<T>;
  down: Series<T>;
  meanBoth: T;
  reversal: T;
  crossCandidate: T;
  repeatabilityBoth: T;
  activeCandidates: Branch[];
}
