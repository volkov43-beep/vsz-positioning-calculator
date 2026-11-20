import { demoProfile, type AxisRequest, type AxisResult } from "../core/axis";
import type { PositionInput } from "../core/contracts";
import type { Direction } from "../core/diagnostics";
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
