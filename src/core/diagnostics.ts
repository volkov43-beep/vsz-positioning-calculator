export type Direction = "up" | "down";
export interface Address {
  positionId: string;
  field: string;
  direction?: Direction;
  repeat?: number;
}
export type Stage = "parse" | "conversion" | "collision" | "representation" | "comparison" | "rounding" | "resource";
const actions: Record<Stage, string> = {
  parse: "Сверьте параметр, подписи серий и исходные записи.",
  conversion: "Проверьте единицу и диапазон исходного значения.",
  collision: "Сопоставьте исходные записи по обоим адресам.",
  representation: "Сверьте исходные десятичные записи с независимым расчётом.",
  comparison: "Сохраните снимок для независимой проверки сравнения.",
  rounding: "Проверьте указанную характеристику и диапазон по независимому эталону.",
  resource: "Сохраните снимок для независимого контроля ресурсного предела.",
};

export class CoreIssue extends Error {
  constructor(readonly stage: Stage, readonly reason: string, message: string,
              readonly address: Address, readonly evidence: Record<string, unknown> = {},
              readonly code = "PRECISION_LOSS") {
    super(message);
  }
  diagnostic(runId: string) {
    return { diagnosticId: runId + "/1", runId, code: this.code, category: this.stage === "parse" ? "input" : "arithmetic",
      severity: "error" as const, stage: this.stage, reason: this.reason, field: this.address,
      message: this.message, action: actions[this.stage], evidence: this.evidence,
      effects: { calculate: "block", applicability: "unchanged", report: "draftOnly" } };
  }
}

export function invalid(address: Address, code: string, message: string): never {
  throw new CoreIssue("parse", code, message, address, {}, code);
}
