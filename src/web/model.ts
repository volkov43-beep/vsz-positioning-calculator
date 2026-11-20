import { demoProfile, type AxisRequest, type AxisResult } from "../core/axis";
import type { PositionInput } from "../core/contracts";
import { CoreIssue, type Address, type Direction } from "../core/diagnostics";
import { normalize } from "../core/input";
import sample from "./t06.json";

export type Success = Extract<AxisResult, { state: "research-computed" }>;
export type LocalPosition = Success["positions"][number];
export const directions = ["up", "down"] as const;
export const directionText = { up: "↑ up", down: "↓ down" };
export const warning =
  "Демонстрационный расчёт. Методика и численная политика проходят согласование. Не использовать для приёмки станков.";
export const sampleData = sample;
export function editorPosition(
  id: string,
  targetMm = "",
  up = Array<string>(5).fill(""),
  down = Array<string>(5).fill(""),
): PositionInput {
  function series(values: string[]) {
    return values.map((raw, index) => ({ raw, repeat: index + 1, sourceUnit: "um" as const }));
  }
  return { positionId: id, targetMm, observations: { up: series(up), down: series(down) } };
}
export function draft(synthetic: boolean): AxisRequest {
  if (
    synthetic &&
    (sample.sourceUnit !== "um" ||
      sample.positions.length !== 5 ||
      new Set(sample.positions.map((p) => p.id)).size !== 5 ||
      sample.positions.some(
        (p) =>
          !p.id ||
          !p.targetMm ||
          directions.some(
            (d) => p[d].length !== 5 || p[d].some((s) => typeof s !== "string" || s.trim() === ""),
          ),
      ))
  )
    throw new Error("Повреждена структура примера T06.");
  return {
    trialId: crypto.randomUUID(),
    inputRevision: 1,
    runId: "draft",
    origin: synthetic ? { kind: "synthetic", sourceId: sample.sourceId } : { kind: "measurement" },
    inputs: {
      profile: demoProfile,
      axis: { kind: "linear", name: "X", fullTravelMm: synthetic ? sample.fullTravelMm : "" },
      positions: synthetic
        ? sample.positions.map((p) => editorPosition(p.id, p.targetMm, p.up, p.down))
        : Array.from({ length: 5 }, (_, i) => editorPosition("p0" + (i + 1))),
    },
    missingReportFields: ["date", "operator", "instrument", "temperature", "warmup"],
  };
}
export function fieldId(id: string, field: string, direction?: Direction, repeat?: number) {
  return [id, field, direction, repeat].filter((x) => x !== undefined).join("-");
}
export function travelEntry(raw: string | null) {
  if (!raw?.trim()) return { label: "не указан", hint: "Укажите полный ход для проверки области применения." };
  try {
    const { d } = normalize(raw, "mm", { field: "fullTravelMm" }, "mm");
    if (d.n > 0n) return { label: raw + " мм", hint: "" };
  } catch (error) {
    if (!(error instanceof CoreIssue)) throw error;
  }
  return { label: "не подтверждён", hint: "Полный ход не подтверждён. Введите положительное число в мм." };
}

export function diagnosticTarget({ positionId, field, direction, repeat }: Address) {
  if (!positionId) return field === "axis" || field === "fullTravelMm" ? field : "positions";
  if (direction) return fieldId(positionId, "raw", direction, repeat ?? 1);
  return fieldId(positionId, "targetMm");
}

export function diagnosticAddress({ positionId, field, direction, repeat }: Address) {
  if (!positionId) {
    if (field === "axis") return "Параметры оси";
    if (field === "fullTravelMm") return "Полный ход оси";
    return "Измерения оси";
  }
  const parts = [positionId];
  if (direction) parts.push(directionText[direction]);
  if (repeat !== undefined) parts.push("повтор " + repeat);
  else if (field === "targetMm") parts.push("координата, мм");
  else if (field === "variance") parts.push("дисперсия");
  return parts.join(" · ");
}
export const displayNumber = (n: number) => String(n).replace(".", ",").replace(/^-/, "−");
export const metrics = [
  ["A", "A", "Двусторонняя точность", "Общий размах границ двух направлений."],
  ["A_up", "A↑", "Точность ↑", "Размах границ прямого подхода."],
  ["A_down", "A↓", "Точность ↓", "Размах границ обратного подхода."],
  ["E", "E", "Систематическое отклонение", "Размах всех направленных средних."],
  ["E_up", "E↑", "Систематическое отклонение ↑", "Размах средних прямого подхода."],
  ["E_down", "E↓", "Систематическое отклонение ↓", "Размах средних обратного подхода."],
  ["M", "M", "Размах двусторонних средних", "Размах средних по позициям."],
  ["R", "R", "Двусторонняя повторяемость", "Наибольшая двусторонняя повторяемость позиции."],
  ["R_up", "R↑", "Повторяемость ↑", "Наибольшая повторяемость прямого подхода."],
  ["R_down", "R↓", "Повторяемость ↓", "Наибольшая повторяемость обратного подхода."],
  ["B", "B", "Зона нечувствительности", "Наибольший модуль разности направленных средних."],
  ["Bbar", "B̄", "Средняя зона нечувствительности", "Средняя знаковая разность по позициям."],
] as const;
