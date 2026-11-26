import type { Q } from "../core/rational";
import { decimalString, readMm } from "./decimal";
import { issue, status, type Approach, type End, type Finding } from "./types";

export function assessReversal(side: End, approach: Approach, target: Q | undefined, limit: Q | null | undefined, findings: Finding[]) {
  const path = "section.approach." + side;
  const required = approach.requiredMm !== null ? readMm(approach.requiredMm, path + ".requiredMm", findings)?.d : null;
  const declared = approach.availableMm !== null ? readMm(approach.availableMm, path + ".availableMm", findings)?.d : null;
  const physical = target && limit ? (side === "left" ? target.sub(limit) : limit.sub(target)) : null;
  const available = declared && physical && declared.cmp(physical) > 0 ? physical : declared ?? physical;
  const evidence = { availableMm: available ? decimalString(available) : null,
    requiredMm: approach.requiredMm, mechanicalSpaceMm: physical && decimalString(physical),
    basis: approach.basis, operatingSpeed: "requires-engineer" as const };
  if (required && required.n < 0n || declared && declared.n < 0n)
    findings.push(issue("error", "NEGATIVE_MARGIN", "Длина движения не может быть отрицательной.", path));
  if (declared && physical && declared.cmp(physical) > 0) {
    const message = "Заявленное движение превышает механически доступное.";
    findings.push(issue("error", "MARGIN_LIMIT", message, path + ".availableMm", "passport.limits"));
    return { ...evidence, ...status("contradiction", "MARGIN_LIMIT", message, path + ".availableMm", "passport.limits") };
  }
  if (approach.bothSides === "impossible" || (available && (available.n <= 0n || required && available.cmp(required) < 0)))
    return { ...evidence, ...status("contradiction", "REVERSAL_IMPOSSIBLE", "Двусторонний подход невозможен или места меньше указанной потребности.", path, "ends." + side) };
  if (target && available && required && required.n >= 0n && approach.basis?.trim() && approach.bothSides === "possible")
    return { ...evidence, ...status("geometry-checked", "MARGIN_CHECKED", "Геометрического пространства достаточно для указанного запаса. Рабочую скорость подтверждает инженер.", path) };
  return { ...evidence, ...status("unconfirmed", "REVERSAL_UNKNOWN", "Требуется подтверждение подхода, доступного хода и обоснованного запаса.", path) };
}
