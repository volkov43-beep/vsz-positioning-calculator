import { aggregate, axisFields, type AxisField, type AxisValues, type Located } from "./aggregate";
import { demoProfile, type PositionInput } from "./contracts";
import { CoreIssue, invalid } from "./diagnostics";
import { rounded } from "./expression";
import { normalize, readPosition, type Trace } from "./input";
import { evaluatePosition, validateAttempt } from "./position";
import { Q } from "./rational";
import { canonicalSnapshot, digestCanonical, snapshotDigest } from "./snapshot";

export { demoProfile };
export const axisAlgorithmVersion = "axis-demo-1";
export interface AxisInputs {
  profile: typeof demoProfile;
  axis: { kind: "linear"; name: string; fullTravelMm: string | null };
  positions: readonly PositionInput[];
}
export interface AxisRequest {
  trialId: string;
  inputRevision: number;
  runId: string;
  inputs: AxisInputs;
  origin: { kind: "synthetic"; sourceId: string } | { kind: "measurement" };
  /** Administrative review supplied separately from the arithmetic snapshot. */
  missingReportFields?: readonly string[];
}

function qualifications(inputs: AxisInputs, missing: readonly string[]) {
  const procedureIssues: string[] = [];
  const m = inputs?.positions?.length ?? 0;
  if (m > 0 && m < 5) procedureIssues.push("PLAN_TOO_SHORT");
  const travel = inputs?.axis?.fullTravelMm;
  if (travel == null) procedureIssues.push("TRAVEL_UNCONFIRMED");
  else {
    try {
      const v = normalize(travel, "mm", { field: "fullTravelMm" }, "mm").d;
      if (v.n <= 0n || v.cmp(new Q(2000n)) > 0) procedureIssues.push("OUTSIDE_TRAVEL_PROFILE");
    } catch (error) {
      if (!(error instanceof CoreIssue)) throw error;
      procedureIssues.push("TRAVEL_UNCONFIRMED");
    }
  }
  if (missing.some((k) => ["instrument", "temperature", "warmup"].includes(k)))
    procedureIssues.push("CONDITIONS_UNCONFIRMED");
  return {
    applicability: {
      state: procedureIssues.some((k) => k === "PLAN_TOO_SHORT" || k === "OUTSIDE_TRAVEL_PROFILE")
        ? ("outOfScope" as const)
        : ("unconfirmed" as const),
      issues: procedureIssues,
    },
    report: {
      state: missing.length ? ("incomplete" as const) : ("notAssessed" as const),
      missingFields: missing,
    },
  };
}

/** Complete the representation gate across the axis before calculating the first local variance. */
function prepareAxis(inputs: AxisInputs) {
  if (inputs.axis?.kind !== "linear" || typeof inputs.axis.name !== "string" || !inputs.axis.name.trim())
    invalid({ field: "axis" }, "AXIS_PROFILE", "Укажите одну линейную ось.");
  if (!Array.isArray(inputs.positions))
    invalid({ field: "positions" }, "POSITION_LIST", "Нужен список позиций.");
  if (!inputs.positions.length)
    throw new CoreIssue(
      "aggregation",
      "axis-undefined",
      "Для пустой оси экстремумы и среднее не определены.",
      { field: "positions" },
      { positionCount: 0 },
      "AXIS_EMPTY",
    );

  const seenBits = new Map<bigint, Trace>();
  const ids = new Map<string, number>();
  const coordinates = new Map<string, string>();
  const targetBits = new Map<string, string>();
  const prepared = [];
  for (const [order, input] of inputs.positions.entries()) {
    if (!input || typeof input !== "object")
      invalid({ field: "positions" }, "POSITION_MISSING", "Отсутствует запись позиции.");
    const id = input.positionId;
    if (ids.has(id))
      throw new CoreIssue(
        "parse",
        "POSITION_ID_DUP",
        "Идентификатор позиции повторяется.",
        { positionId: id, field: "positionId" },
        { sourcePaths: [ids.get(id), order] },
        "POSITION_ID_DUP",
      );
    ids.set(id, order);
    const measurements = readPosition(input, seenBits);
    const { target } = measurements;
    if (coordinates.has(target.normalized))
      throw new CoreIssue(
        "parse",
        "COORD_DUP",
        "Повторяется заданная координата.",
        { positionId: id, field: "targetMm" },
        { firstPositionId: coordinates.get(target.normalized) },
        "COORD_DUP",
      );
    if (targetBits.has(target.bits))
      throw new CoreIssue(
        "collision",
        "coordinate-collision",
        "Две разные координаты имеют одно представление в мм.",
        { positionId: id, field: "targetMm" },
        { firstPositionId: targetBits.get(target.bits), bits: target.bits },
      );
    coordinates.set(target.normalized, id);
    targetBits.set(target.bits, id);
    prepared.push({ id, measurements });
  }
  return prepared;
}

/** Input-only action for the editor. It checks the same snapshot gate as a real attempt. */
export function checkAxisInputs(inputs: AxisInputs) {
  try {
    prepareAxis(inputs);
    return { valid: true as const };
  } catch (error) {
    if (!(error instanceof CoreIssue)) throw error;
    return { valid: false as const, issue: error };
  }
}

function compute(prepared: ReturnType<typeof prepareAxis>) {
  const representedRows: Located[] = [];
  const sourceRows: Located[] = [];
  const positions = [];
  let changedObservations = 0;
  for (const { id, measurements } of prepared) {
    const p = evaluatePosition(id, measurements);
    representedRows.push({ positionId: id, value: p.protectedPosition });
    sourceRows.push({ positionId: id, value: p.source });
    positions.push(p.position);
    changedObservations += p.changed;
  }
  const represented = aggregate(representedRows);
  const source = changedObservations ? aggregate(sourceRows) : represented;
  const axis = {} as AxisValues<number>;
  const changedAxisFields: AxisField[] = [];
  for (const field of axisFields) {
    const b = represented.exact[field],
      d = source.exact[field];
    if (b.isZero() && !d.isZero())
      throw new CoreIssue(
        "representation",
        "derived-nonzero-to-zero",
        "Ненулевая осевая характеристика исходных данных исчезла при представлении входов.",
        { field },
        { represented: "0", sourceWasNonzero: true },
      );
    if (changedObservations && !b.sub(d).isZero()) changedAxisFields.push(field);
    axis[field] = rounded(b, { field });
  }
  return {
    positions,
    axis,
    extrema: represented.extrema,
    positionCount: positions.length,
    observationCount: 10 * positions.length,
    units: { coordinate: "mm", deviation: "um", variance: "um2", axis: "um" } as const,
    representation: { changedObservations, changedAxisFields },
  };
}

/** Clone before the first await, so the key and the actual calculation refer to the same revision. */
export async function calculateAxis(request: AxisRequest) {
  const {
    trialId,
    inputRevision,
    runId,
    inputs,
    origin,
    missingReportFields = [],
  } = structuredClone(request);
  const profile = inputs?.profile;
  const key = {
    trialId,
    inputRevision,
    runId,
    inputDigest: null as string | null,
    profileId: profile?.profileId,
    profileVersion: profile?.profileVersion,
    sdMethod: profile?.sdMethod,
    algorithmVersion: axisAlgorithmVersion,
    numericalPolicyVersion: profile?.numericalPolicyVersion,
  };
  const common = {
    key,
    origin,
    inputSnapshot: inputs,
    executionPurpose: "research-demo" as const,
    methodStatus: "proposed" as const,
    productionEligible: false as const,
    budgetStatus: "budget-not-approved" as const,
    ...qualifications(inputs, missingReportFields),
  };
  let inputStatus: "unconfirmed" | "valid" = "unconfirmed";
  try {
    try {
      key.inputDigest = await snapshotDigest(inputs);
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      invalid({ field: "inputs" }, "SNAPSHOT_INVALID", "Снимок должен содержать данные формата JSON.");
    }
    validateAttempt(profile, runId, trialId, inputRevision, key.inputDigest);
    if (
      !origin ||
      (origin.kind !== "measurement" &&
        (origin.kind !== "synthetic" || typeof origin.sourceId !== "string" || !origin.sourceId.trim()))
    )
      invalid(
        { field: "origin" },
        "ORIGIN_INVALID",
        "Укажите происхождение данных и ID синтетического примера.",
      );
    const prepared = prepareAxis(inputs);
    inputStatus = "valid";
    return {
      ...common,
      ...compute(prepared),
      state: "research-computed" as const,
      inputStatus: "valid" as const,
    };
  } catch (error) {
    if (!(error instanceof CoreIssue)) throw error;
    return {
      ...common,
      state: error.stage === "parse" ? ("notStarted" as const) : ("failed" as const),
      inputStatus:
        error.stage === "parse"
          ? ("invalid" as const)
          : error.code === "AXIS_EMPTY"
            ? ("empty" as const)
            : inputStatus,
      errors: [error.diagnostic(runId)],
    };
  }
}

export type AxisResult = Awaited<ReturnType<typeof calculateAxis>>;

/** Compare against the currently active attempt, including same-revision edits and late responses. */
export async function isCurrentAxisResult(result: AxisResult, active: AxisRequest): Promise<boolean> {
  if (result.state !== "research-computed") return false;
  const { key } = result;
  function sameAttempt() {
    const profile = active.inputs?.profile;
    return (
      profile?.executionPurpose === "research-demo" &&
      active.origin?.kind === result.origin.kind &&
      (result.origin.kind !== "synthetic" ||
        (active.origin.kind === "synthetic" && active.origin.sourceId === result.origin.sourceId)) &&
      key.runId === active.runId &&
      key.trialId === active.trialId &&
      key.inputRevision === active.inputRevision &&
      key.algorithmVersion === axisAlgorithmVersion &&
      key.profileId === profile.profileId &&
      key.profileVersion === profile.profileVersion &&
      key.sdMethod === profile.sdMethod &&
      key.numericalPolicyVersion === profile.numericalPolicyVersion
    );
  }
  if (!sameAttempt()) return false;
  try {
    const captured = canonicalSnapshot(active.inputs);
    const digest = await digestCanonical(captured);
    // The draft can be edited while Web Crypto is running.
    return key.inputDigest === digest && sameAttempt() && canonicalSnapshot(active.inputs) === captured;
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof CoreIssue) return false;
    throw error;
  }
}
