import { algorithmVersion, demoProfile, type Branch, type Position, type Request, type Series } from "./contracts";
import { CoreIssue, invalid, type Address, type Direction } from "./diagnostics";
import { compare, Expr, rounded } from "./expression";
import { readPosition, type Trace } from "./input";
import { Q } from "./rational";
import { series } from "./series";

export { algorithmVersion, demoProfile };
export type { Attempt, Observation, Position, PositionInput, Request, Series } from "./contracts";

function exactPosition(up: Series<Expr>, down: Series<Expr>, positionId: string): Position<Expr> {
  const meanBoth = up.mean.add(down.mean).scale(new Q(1n, 2n));
  const reversal = up.mean.sub(down.mean);
  const crossCandidate = up.twoSd.add(down.twoSd).add(new Expr(reversal.base.abs()));
  let best = crossCandidate;
  let activeCandidates: Branch[] = ["cross"];
  for (const [branch, candidate] of [["up", up.repeatability], ["down", down.repeatability]] as const) {
    const order = compare(candidate, best, { positionId, field: "activeCandidates", direction: branch });
    if (order > 0) {
      best = candidate;
      activeCandidates = [branch];
    } else if (order === 0) activeCandidates.push(branch);
  }
  return { up, down, meanBoth, reversal, crossCandidate, repeatabilityBoth: best, activeCandidates };
}

function seriesFrom(traces: Record<Direction, Trace[]>, source: "b" | "d", pid: string) {
  return exactPosition(series(traces.up.map(t => t[source])), series(traces.down.map(t => t[source])), pid);
}

function present(exact: Position<Expr>, positionId: string, source?: Position<Expr>): Position<number> {
  function output(value: Expr, address: Address, decimalValue?: Expr) {
    if (value.isZero() && decimalValue && !decimalValue.isZero())
      throw new CoreIssue("representation", "derived-nonzero-to-zero",
        "Ненулевая характеристика исходных десятичных данных исчезла при представлении входов.",
        address, { represented: "0", sourceWasNonzero: true });
    return rounded(value, address);
  }
  function publicSeries(direction: Direction) {
    const field = (name: keyof Series<Expr>) => output(exact[direction][name],
      { positionId, direction, field: name }, source?.[direction][name]);
    return { mean: field("mean"), variance: field("variance"), sd: field("sd"), twoSd: field("twoSd"),
      range: field("range"), lower: field("lower"), upper: field("upper"), repeatability: field("repeatability") };
  }
  const field = (name: "meanBoth" | "reversal" | "crossCandidate" | "repeatabilityBoth") =>
    output(exact[name], { positionId, field: name }, source?.[name]);
  return { up: publicSeries("up"), down: publicSeries("down"), meanBoth: field("meanBoth"),
    reversal: field("reversal"), crossCandidate: field("crossCandidate"), repeatabilityBoth: field("repeatabilityBoth"),
    activeCandidates: [...exact.activeCandidates] };
}

/** Pure, synchronous position primitive. The caller owns the enclosing trial and its revision. */
export function calculatePosition(request: Request) {
  const { position, profile, runId, trialId, inputRevision, inputDigest } = structuredClone(request);
  const key = { runId, trialId, inputRevision, inputDigest, algorithmVersion,
    profileId: profile?.profileId, profileVersion: profile?.profileVersion, sdMethod: profile?.sdMethod,
    numericalPolicyVersion: profile?.numericalPolicyVersion };
  const common = { key, executionPurpose: "research-demo" as const, inputSnapshot: { position, profile },
    methodStatus: "proposed" as const, budgetStatus: "budget-not-approved" as const,
    productionEligible: false as const };
  const positionId = position?.positionId ?? "";
  try {
    if (!position || typeof position !== "object") invalid({ positionId, field: "position" }, "POSITION_MISSING",
      "Отсутствует входной снимок позиции.");
    for (const name of Object.keys(demoProfile) as (keyof typeof demoProfile)[]) {
      if (profile?.[name] !== demoProfile[name]) invalid({ positionId, field: name }, "PROFILE_UNSUPPORTED",
        "Параметр не поддерживается исследовательским профилем.");
    }
    if (typeof runId !== "string" || !runId.trim() || typeof trialId !== "string" || !trialId.trim() ||
        !Number.isSafeInteger(inputRevision) || inputRevision < 1 || typeof inputDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(inputDigest))
      invalid({ positionId, field: "attempt" }, "ATTEMPT_KEY", "Проверьте идентификаторы, редакцию и SHA-256 снимка.");
    const { target, traces } = readPosition(position);
    const targetMm = rounded(new Expr(target.d), { positionId, field: "targetMm" });
    const protectedPosition = seriesFrom(traces, "b", positionId);
    // A demonstrated loss of a nonzero derived value can occur with ten distinct machine inputs.
    const sourceChanged = [...traces.up, ...traces.down].some(t => t.error.n !== 0n);
    const source = sourceChanged ? seriesFrom(traces, "d", positionId) : undefined;
    const fields = present(protectedPosition, positionId, source);
    return { ...common, state: "research-computed" as const,
      position: { positionId, targetMm, ...fields },
      units: { coordinate: "mm", deviation: "um", variance: "um2" } as const,
      representedInputs: { target, ...traces }, protectedPosition,
      warnings: [{ reason: "budget-not-approved", stage: "budget", severity: "warning",
        message: "Исследовательский расчёт над b. Бюджеты влияния d→b ожидают согласования." }] };
  } catch (error) {
    if (!(error instanceof CoreIssue)) throw error;
    return { ...common, state: error.stage === "parse" ? "notStarted" as const : "failed" as const,
      errors: [error.diagnostic(runId)] };
  }
}
