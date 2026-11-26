import { Q } from "../core/rational";
import { decimalString, readMm } from "./decimal";
import { algorithmVersion, densityRule, issue, maxPositions, status, type Finding, type Passport, type PlanRequest, type Status } from "./types";

export function recommendCount(passport: Passport) {
  const findings: Finding[] = [];
  const field = "passport.fullTravelMm";
  const travel = readMm(passport.fullTravelMm, field, findings)?.d;
  const unknown = status("undetermined", "TRAVEL_UNKNOWN", "Ориентир для короткой оси — от пяти позиций. Подсказка по длине недоступна.", field);
  let profile: Status<"short" | "outside" | "undetermined"> = unknown;
  let minimum: number | null = null;
  if (passport.kind !== "linear") {
    profile = status("outside", "AXIS_KIND", "Поддерживается одна линейная ось.", "passport.kind");
  } else if (travel && travel.n <= 0n) {
    findings.push(issue("error", "TRAVEL_NONPOSITIVE", "Полный ход должен быть положительным.", field));
  } else if (travel && travel.cmp(new Q(2000n)) > 0) {
    profile = status("outside", "LONG_TRAVEL", "Указанный ход превышает 2000 мм.", field);
  } else if (travel && passport.travelConfirmed && passport.travelSource?.trim()) {
    const quotient = travel.div(new Q(200n));
    minimum = Math.max(5, Number((quotient.n + quotient.d - 1n) / quotient.d));
    profile = status("short", "SHORT_AXIS", "По подтверждённому полному ходу выбран короткоходовой профиль.", field);
  } else if (travel) {
    findings.push(issue("missing", "TRAVEL_CONFIRMATION", "Укажите источник и подтверждение полного хода.", "passport.travelSource", "passport.travelConfirmed"));
  }
  return { profile, minimum, rule: densityRule, basis: "fullTravelMm" as const, fullTravelMm: passport.fullTravelMm, findings };
}

export function geometry(r: PlanRequest) {
  const recommendation = recommendCount(r.passport);
  const findings = [...recommendation.findings];
  function missing(value: string | null | undefined, address: string) {
    if (!value?.trim()) findings.push(issue("missing", "MISSING_CONTEXT", "Укажите основание или обозначение.", address));
  }
  missing(r.passport.name, "passport.name");
  missing(r.passport.frame?.system, "passport.frame.system");
  missing(r.passport.frame?.positiveDirection, "passport.frame.positiveDirection");
  missing(r.section.source, "section.source");
  missing(r.ends.left.basis, "ends.left.basis");
  missing(r.ends.right.basis, "ends.right.basis");
  missing(r.base.trialId, "base.trialId");
  missing(r.base.conditionsVersion, "base.conditionsVersion");
  if (!/^[0-9a-f]{64}$/.test(r.base.inputDigest) || !Number.isSafeInteger(r.base.inputRevision) || r.base.inputRevision < 1)
    findings.push(issue("error", "BASE_KEY", "Проверьте редакцию и SHA-256 исходных входов.", "base.inputRevision", "base.inputDigest"));
  if (r.algorithmVersion !== algorithmVersion)
    findings.push(issue("error", "VERSION", "Неизвестная версия алгоритма.", "algorithmVersion"));
  if (!Number.isInteger(r.decimalPlaces) || r.decimalPlaces < 0 || r.decimalPlaces > 12)
    findings.push(issue("error", "PRECISION", "Для интерполяции укажите от 0 до 12 знаков после запятой.", "decimalPlaces"));
  if (r.desiredCount !== "recommended" && (!Number.isSafeInteger(r.desiredCount) || r.desiredCount < 2 || r.desiredCount > maxPositions))
    findings.push(issue("error", "COUNT_RANGE", "Количество вне ресурсного диапазона планировщика.", "desiredCount"));
  const parse = (v: string | null, address: string) => readMm(v, address, findings)?.d;
  const start = parse(r.section.startMm, "section.startMm");
  const end = parse(r.section.endMm, "section.endMm");
  const left = parse(r.ends.left.rawMm, "ends.left.rawMm");
  const right = parse(r.ends.right.rawMm, "ends.right.rawMm");
  const min = r.passport.limits && parse(r.passport.limits.minMm, "passport.limits.minMm");
  const max = r.passport.limits && parse(r.passport.limits.maxMm, "passport.limits.maxMm");
  const origin = r.grid && parse(r.grid.originMm, "grid.originMm");
  const step = r.grid && parse(r.grid.stepMm, "grid.stepMm");
  if (r.grid && r.grid.rounding !== "nearest-ties-away-from-origin")
    findings.push(issue("error", "GRID_RULE", "Неизвестное правило приведения к сетке.", "grid.rounding"));
  if (step && step.n <= 0n) findings.push(issue("error", "GRID_STEP", "Шаг сетки должен быть положительным.", "grid.stepMm"));
  const sectionLength = start && end ? end.sub(start) : null;
  if (sectionLength && sectionLength.n <= 0n)
    findings.push(issue("error", "SECTION_ORDER", "Конец участка должен быть больше начала.", "section.startMm", "section.endMm"));
  const travel = recommendation.profile.state === "short" ? parse(r.passport.fullTravelMm, "passport.fullTravelMm") : undefined;
  if (min && max && travel && max.sub(min).cmp(travel) > 0)
    findings.push(issue("error", "LIMIT_SPAN", "Доступный диапазон шире паспортного хода.", "passport.limits", "passport.fullTravelMm"));
  if (sectionLength && travel && sectionLength.cmp(travel) > 0)
    findings.push(issue("error", "SECTION_LENGTH", "Участок длиннее паспортного хода.", "section", "passport.fullTravelMm"));
  if (min && max && min.cmp(max) >= 0)
    findings.push(issue("error", "LIMIT_ORDER", "Проверьте порядок пределов движения.", "passport.limits"));
  if (start && min && start.cmp(min) < 0 || end && max && end.cmp(max) > 0)
    findings.push(issue("error", "SECTION_LIMITS", "Участок выходит за пределы движения.", "section", "passport.limits"));
  if (left && right && left.cmp(right) >= 0)
    findings.push(issue("error", "END_ORDER", "Крайние цели должны возрастать.", "ends.left", "ends.right"));
  if (left && start && left.cmp(start) < 0 || right && end && right.cmp(end) > 0)
    findings.push(issue("error", "END_BOUNDS", "Крайняя цель выходит за измерительный участок.", "ends", "section"));
  return { recommendation, findings, start, end, left, right, min, max, origin, step,
    sectionLengthMm: sectionLength && decimalString(sectionLength) };
}
export type Geometry = ReturnType<typeof geometry>;
