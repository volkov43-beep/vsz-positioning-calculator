import { snapshotDigest } from "../core/snapshot";
import { assignIds } from "./identities";
import { coordinates } from "./coordinates";
import { decimalString } from "./decimal";
import { generate } from "./generate";
import { geometry } from "./geometry";
import { assessReversal } from "./reversal";
import { issue, maxPositions, sourceRow, status, type PlanRequest, type PlanRow, type Review, type Rule } from "./types";

async function assess(request: PlanRequest, supplied?: readonly PlanRow[], attestation?: Review) {
  const r = structuredClone(request);
  if (r.previousTargets === undefined) delete r.previousTargets;
  const g = geometry(r);
  const findings = [...g.findings];
  const review = attestation && structuredClone(attestation);
  const overLimit = supplied && supplied.length > maxPositions;
  if (overLimit) findings.push(issue("error", "PLAN_LIMIT", "Превышен ресурсный предел числа позиций.", "positions"));
  const rows = supplied ? (overLimit ? [] : supplied.map(sourceRow)) : generate(r, g, findings);
  if (!supplied && rows.length) assignIds(r, g, rows, findings);
  if (supplied && !supplied.length) findings.push(issue("missing", "EMPTY_PLAN", "Укажите позиции плана.", "positions"));
  const draft = coordinates(r, rows, g, findings);
  const reversal = {
    left: assessReversal("left", r.section.approach.left, draft.first, g.min, findings),
    right: assessReversal("right", r.section.approach.right, draft.last, g.max, findings),
  };
  const { profile, minimum } = g.recommendation;
  const rules: Rule[] = [];
  const gridChecked = !!r.grid && rows.length > 0 && draft.positions.every(p => p.executableMm !== null);
  if (profile.state === "outside") rules.push(status("not-applicable", "DENSITY", "Подсказка доступна только для короткой линейной оси.", "passport"));
  else if (minimum === null || !rows.length) rules.push(status("unknown", "DENSITY", "Недостаточно данных для проверки количества.", "passport.fullTravelMm", "positions"));
  else rules.push(status(rows.length >= minimum ? "passed" : "violated", "DENSITY", "Предложенный минимум по полному ходу: " + minimum + ". Получено: " + rows.length + ".", "positions", "passport.fullTravelMm"));
  if (r.desiredCount !== "recommended" && rows.length && r.desiredCount !== rows.length)
    findings.push(issue("error", "COUNT_MISMATCH", "Число строк отличается от явного запроса.", "desiredCount", "positions"));
  if (r.section.choice === "fixed")
    rules.push(status("not-applicable", "SPACING", "Инженер оценивает основание фиксированных позиций.", "section.constraints"));
  else if (r.section.choice !== "free" || (r.grid && !gridChecked) || draft.gaps.length < 2 || draft.gaps.length !== rows.length - 1 || draft.gaps.some(gap => !gap || gap.n <= 0n))
    rules.push(status("unknown", "SPACING", "Нужны условия свободного выбора и возрастающие координаты.", "section.choice", "positions"));
  else {
    const uniform = draft.gaps.every(x => x!.cmp(draft.gaps[0]!) === 0);
    rules.push(status(uniform ? "violated" : "passed", "SPACING",
      uniform ? "Все конечные интервалы одинаковы." : "Есть неодинаковые интервалы. Пригодность размещения оценивает инженер.",
      "positions[0]", "positions[" + (rows.length - 1) + "]"));
  }
  if (r.section.choice === "fixed" && !r.section.constraints.some(x => x.trim()))
    findings.push(issue("missing", "FIXED_BASIS", "Укажите причину фиксированного размещения.", "section.constraints"));
  const gridError = findings.some(f => f.level === "error" && f.addresses.some(a => a.startsWith("grid.") || a.includes(".executableMm")));
  const gridState = gridError ? "violated" : gridChecked ? "passed" : "unknown";
  rules.push(status(gridState, "GRID", r.grid ? "Приведение к заданной сетке и проверка исполнительных координат." : "Разрешение станка неизвестно.", "grid", "positions"));
  for (const side of ["left", "right"] as const) {
    const result = reversal[side];
    rules.push(status(result.state === "contradiction" ? "violated" : result.state === "geometry-checked" ? "passed" : "unknown",
      result.code, result.message, ...result.addresses));
  }
  const error = findings.find(f => f.level === "error");
  const missing = findings.find(f => f.level === "missing");
  // Missing applicability evidence can coexist with a structurally complete manual plan.
  const structuralMissing = findings.find(f => f.level === "missing" && !f.addresses.every(a =>
    a.startsWith("passport.fullTravel") || a.startsWith("passport.travel") || a === "section.constraints"));
  const structure = error ? status("invalid", error.code, error.message, ...error.addresses)
    : structuralMissing ? status("incomplete", structuralMissing.code, structuralMissing.message, ...structuralMissing.addresses)
    : !rows.length ? status("incomplete", "EMPTY_PLAN", "Позиции плана отсутствуют.", "positions")
    : status("correct", "STRUCTURE", "Параметры и адреса структурно корректны.", "request", "positions");
  // Non-finite numeric parameters are invalid DTO fields and have no canonical JSON digest.
  const keyNumbers = [r.decimalPlaces, r.base.inputRevision];
  if (r.desiredCount !== "recommended") keyNumbers.push(r.desiredCount);
  const version = keyNumbers.every(Number.isFinite) ? await snapshotDigest({ request: r, rows }) : "";
  const reviewMatches = version !== "" && review?.proposalVersion === version && !!review.basis.trim() && review.conditions.some(c => c.trim());
  const engineering = review && reviewMatches
    ? status(review.decision, "REVIEW", review.basis, ...review.conditions)
    : status("pending", "REVIEW_PENDING", "Требуется инженерное решение для этой версии размещения.", "review");
  if (review && !reviewMatches) findings.push(issue("warning", "REVIEW_STALE", "Подтверждение не относится к этому плану или не содержит основания.", "review"));
  const rejected = error || profile.state === "outside" || rules.some(rule => rule.state === "violated") || engineering.state === "rejected";
  const state = rejected ? "refused" as const : missing || !rows.length || profile.state !== "short" ? "needs-input" as const : "draft" as const;
  return { state, version, request: r, structure, profile, rules, engineering, review: review ?? null, findings,
    recommendation: g.recommendation, methodStatus: "Proposed" as const, numericalPolicy: "vsz-num-0.2 / Proposed" as const,
    sectionLengthMm: g.sectionLengthMm, targetSpanMm: draft.spanMm, positions: draft.positions,
    count: rows.length, intervalsMm: draft.gaps.map(gap => gap && decimalString(gap)), reversal,
    pendingConditions: ["Согласование крайних позиций и охвата", "Влияние периодических ошибок", "Рабочая скорость после реверса"]
      .filter(condition => engineering.state !== "confirmed-listed" || !review?.conditions.includes(condition)) };
}
export function propose(request: PlanRequest) {
  return assess(request);
}
export function validate(request: PlanRequest, rows: readonly PlanRow[], review?: Review) {
  return assess(request, rows, review);
}
export type Proposal = Awaited<ReturnType<typeof validate>>;
