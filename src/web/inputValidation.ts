import type { AxisInputs } from "../core/axis";
import { CoreIssue, type Address } from "../core/diagnostics";
import { normalize } from "../core/input";
import { diagnosticTarget, directions } from "./model";

export type FieldState = "empty" | "editing" | "valid-numeric" | "invalid-format" | "numeric-rejected";
type Assessment = { state: FieldState; message: string };
export type Field = Assessment & { id: string; address: Address };
export type Diagnostic = ReturnType<CoreIssue["diagnostic"]>;

// Only prefixes for which the user may still be typing. normalize decides acceptance on commit.
const partial = /^[+−-]?(?:[.,]|\d+[.,]|(?:\d+(?:[.,]\d*)?|[.,]\d+)[eE][+−-]?)?$/;

export function classify(raw: string | null, unit: "mm" | "um", editing = false): Assessment {
  if (raw == null || raw === "") {
    return { state: "empty", message: unit === "mm" ? "Укажите координату в мм." : "Измерение не заполнено." };
  }
  let result: Assessment;
  try {
    normalize(raw, unit, { field: unit === "mm" ? "targetMm" : "raw" }, unit);
    result = { state: "valid-numeric", message: "" };
  } catch (error) {
    if (!(error instanceof CoreIssue)) throw error;
    if (error.stage !== "parse") {
      return { state: "numeric-rejected", message: error.message + " (" + error.code + " · " + error.reason + ")" };
    }
    result = { state: "invalid-format", message: error.message };
  }
  if (editing && raw.trim() && partial.test(raw.trim())) return { state: "editing", message: "Ввод числа…" };
  return result;
}

export function inspectInputs(inputs: AxisInputs, editingId?: string, diagnostic?: Diagnostic | null) {
  const fields = new Map<string, Field>();
  const problems: Field[] = [];
  const positions = new Map<string, { valid: number; coordinate: FieldState; errors: number }>();
  const counts = { valid: 0, empty: 0, format: 0, rejected: 0, editing: 0 };
  let coordinates = 0;
  function record(address: Address, assessment: Assessment) {
    const id = diagnosticTarget(address);
    const field = { ...assessment, address, id };
    fields.set(id, field);
    if (field.state !== "valid-numeric") problems.push(field);
    return field;
  }
  if (!inputs.axis.name.trim()) record({ field: "axis" }, { state: "empty", message: "Укажите обозначение оси." });
  if (!inputs.positions.length) record({ field: "positions" }, { state: "empty", message: "Добавьте позицию." });

  // Repeated spellings within the form share a single conversion in this pass.
  const cache = { mm: new Map<string | null, Assessment>(), um: new Map<string | null, Assessment>() };
  function numberField(address: Address, raw: string | null, unit: "um" | "mm") {
    const id = diagnosticTarget(address);
    if (diagnostic && (diagnostic.field.field === "targetMm" || diagnostic.field.repeat !== undefined)
        && diagnosticTarget(diagnostic.field) === id) {
      const reason = diagnostic.code === diagnostic.reason ? diagnostic.code : diagnostic.code + " · " + diagnostic.reason;
      return record(address, { state: "numeric-rejected", message: diagnostic.message + " (" + reason + ")" });
    }
    if (editingId === id) return record(address, classify(raw, unit, true));
    let assessment = cache[unit].get(raw);
    if (!assessment) {
      assessment = classify(raw, unit);
      cache[unit].set(raw, assessment);
    }
    return record(address, assessment);
  }
  for (const row of inputs.positions) {
    const positionId = row.positionId;
    const coord = numberField({ positionId, field: "targetMm" }, row.targetMm, "mm");
    if (coord.state === "valid-numeric") coordinates++;
    const stats = { valid: 0, coordinate: coord.state, errors: 0 };
    for (const direction of directions) {
      for (const obs of row.observations[direction]) {
        const { state } = numberField({ positionId, direction, repeat: obs.repeat, field: "raw" }, obs.raw, "um");
        switch (state) {
          case "valid-numeric": counts.valid++; stats.valid++; break;
          case "invalid-format": counts.format++; stats.errors++; break;
          case "numeric-rejected": counts.rejected++; stats.errors++; break;
          case "empty": counts.empty++; break;
          case "editing": counts.editing++; break;
        }
      }
    }
    positions.set(positionId, stats);
  }
  function priority(f: Field) {
    if (f.state !== "empty") return 0;
    return f.address.field === "raw" ? 2 : 1;
  }
  problems.sort((a, b) => priority(a) - priority(b));
  return { fields, problems, positions, coordinates, counts };
}
