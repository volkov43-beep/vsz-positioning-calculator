import { bitPattern, exactBinary, fromBits, rationalBits } from "./binary64";
import type { Observation, PositionInput } from "./contracts";
import { CoreIssue, invalid, type Address, type Direction } from "./diagnostics";
import { Q } from "./rational";

export const directions = ["up", "down"] as const;
const decimal = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?$/;
const decimalLimit = 4096;

function decimalResource(address: Address): never {
  throw new CoreIssue("resource", "decimal-resource-limit", "Исходная запись превышает лимит разбора.", address,
    { maxRawCharacters: decimalLimit, maxAbsoluteExponent: decimalLimit });
}

function canonical(digits: string, power: number, sign: string): string {
  const significant = digits.replace(/^0+/, "");
  if (!significant) return "0";
  const trimmed = significant.replace(/0+$/, "");
  const point = significant.length + power;
  const prefix = sign === "-" ? "-" : "";
  if (point <= 0) return prefix + "0." + "0".repeat(-point) + trimmed;
  if (point >= trimmed.length) return prefix + trimmed + "0".repeat(point - trimmed.length);
  return prefix + trimmed.slice(0, point) + "." + trimmed.slice(point);
}

export function normalize(raw: string | null, sourceUnit: string, address: Address, to: "um" | "mm" = "um") {
  if (sourceUnit === "mm/um" || sourceUnit === "um/mm") invalid({ ...address, field: "sourceUnit" }, "UNIT_AMBIGUOUS", "Укажите одну единицу отклонения.");
  if (sourceUnit !== "um" && sourceUnit !== "mm") invalid({ ...address, field: "sourceUnit" }, "UNIT_UNKNOWN", "Укажите мм или мкм.");
  if (raw === null || raw === undefined) invalid(address, "OBS_MISSING", "Отсутствует измеренное отклонение.");
  if (raw === "") invalid(address, "OBS_EMPTY", "Заполните исходное значение.");
  if (typeof raw !== "string") invalid(address, "OBS_TYPE", "Нужна исходная десятичная строка.");
  if (raw.length > decimalLimit) decimalResource(address);
  const text = raw.trim().replaceAll("−", "-").replaceAll(",", ".");
  if (!text) invalid(address, "OBS_WHITESPACE", "Запись содержит только пробелы.");
  const match = decimal.exec(text);
  if (!match) {
    let code = "OBS_MALFORMED";
    if (/^[+-]?nan$/i.test(text)) code = "OBS_NAN";
    else if (/^[+-]?(inf|infinity)$/i.test(text)) code = "OBS_INFINITY";
    else if (/^[a-z]+$/i.test(text)) code = "OBS_TEXT";
    invalid(address, code, "Введите конечное десятичное число без группировки разрядов.");
  }
  const [, sign, mantissa, exponent = "0"] = match;
  const exp = Number(exponent);
  if (Math.abs(exp) > decimalLimit) decimalResource(address);
  const fractionLength = mantissa.split(".")[1]?.length ?? 0;
  const digits = mantissa.replace(".", "");
  const power = exp - fractionLength;
  const n = BigInt((sign === "-" ? "-" : "") + digits);
  const scale = sourceUnit === to ? 0 : sourceUnit === "mm" ? 3 : -3;
  const exactDecimal = power >= 0 ? new Q(n * 10n**BigInt(power)) : new Q(n, 10n**BigInt(-power));
  const d = scale === 0 ? exactDecimal : scale > 0 ? exactDecimal.mul(new Q(1000n)) : exactDecimal.div(new Q(1000n));
  const normalized = canonical(digits, power + scale, sign);
  const binary64 = fromBits(rationalBits(d));
  const evidence = { raw, sourceUnit, normalized, unit: to, bits: bitPattern(binary64).toString(16).padStart(16, "0") };
  if (!Number.isFinite(binary64))
    throw new CoreIssue("conversion", "input-nonfinite", "Преобразование даёт бесконечность.", address, evidence);
  const b = exactBinary(binary64);
  if (d.n !== 0n && b.n === 0n)
    throw new CoreIssue("conversion", "input-nonzero-to-zero", "Ненулевой вход округляется в ноль.", address, evidence);
  return { ...evidence, address, exactDecimal, d, binary64, b, error: b.sub(d) };
}

export type Trace = ReturnType<typeof normalize>;

export function readPosition(position: PositionInput, seenBits = new Map<bigint, Trace>()) {
  const { positionId, observations } = position;
  const pos = { positionId, field: "positionId" };
  if (typeof positionId !== "string" || !positionId.trim()) invalid(pos, "POSITION_ID", "Укажите идентификатор позиции.");
  const target = normalize(position.targetMm, "mm", { positionId, field: "targetMm" }, "mm");
  if (!observations || typeof observations !== "object") invalid(pos, "DIRECTION_MISSING", "Нужны обе направленные серии.");
  if (Object.keys(observations).some(k => k !== "up" && k !== "down"))
    invalid(pos, "DIRECTION_UNKNOWN", "Допустимы направления up и down.");
  const traces: Record<Direction, Trace[]> = { up: [], down: [] };
  for (const direction of directions) {
    const address = { positionId, field: "observations", direction };
    const series = observations[direction];
    if (!Array.isArray(series)) invalid(address, "DIRECTION_MISSING", "Отсутствует направленная серия.");
    if (series.length !== 5) invalid(address, series.length < 5 ? "SERIES_SHORT" : "SERIES_LONG",
      "Для направления требуется пять подходов. Получено: " + series.length);
    const repeats = new Set<number>();
    for (const obs of series as readonly Observation[]) {
      if (!obs || !Number.isInteger(obs.repeat) || obs.repeat < 1 || obs.repeat > 5)
        invalid(address, "REPEAT_RANGE", "Номер подхода должен быть целым от 1 до 5.");
      const field = { ...address, repeat: obs.repeat, field: "raw" };
      if (repeats.has(obs.repeat)) invalid({ ...field, field: "repeat" }, "REPEAT_DUP", "Номер подхода повторяется.");
      repeats.add(obs.repeat);
      const trace = normalize(obs.raw, obs.sourceUnit, field);
      const key = bitPattern(trace.binary64);
      const prior = seenBits.get(key);
      if (prior && prior.d.cmp(trace.d) !== 0)
        throw new CoreIssue("collision", "input-collision", "Разные отклонения дали одно машинное значение.", field,
          { first: prior.address, firstRaw: prior.raw, firstUnit: prior.sourceUnit, firstD: prior.normalized,
            secondRaw: trace.raw, secondUnit: trace.sourceUnit, secondD: trace.normalized, bits: trace.bits });
      if (!prior) seenBits.set(key, trace);
      traces[direction].push(trace);
    }
    traces[direction].sort((a, b) => a.address.repeat! - b.address.repeat!);
  }
  return { target, traces };
}
