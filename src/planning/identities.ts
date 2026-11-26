import { readMm, quantize } from "./decimal";
import type { Geometry } from "./geometry";
import { issue, type Finding, type PlanRequest, type PlanRow } from "./types";

// Reuse an existing ID only for an unambiguous physical coordinate in the same frame.
// Reserve every old ID, including those of deleted and unfinished rows.
export function assignIds(r: PlanRequest, g: Geometry, rows: PlanRow[], findings: Finding[]) {
  const existing = r.previousTargets;
  if (!existing) return;
  const frame = r.passport.frame;
  const sameFrame = frame && existing.axisName === r.passport.name && frame.system === existing.frame?.system
    && frame.positiveDirection === existing.frame.positiveDirection;
  const reserved = new Set<string>();
  const byTarget = new Map<string, string | null>();
  for (const [i, row] of existing.positions.entries()) {
    if (!row.positionId.trim() || reserved.has(row.positionId))
      findings.push(issue("error", "BASE_IDENTITIES", "Проверьте ID исходной записи.", "previousTargets.positions[" + i + "]"));
    reserved.add(row.positionId);
    const v = sameFrame && readMm(row.targetMm, "targetMm", []);
    if (v) {
      const key = v.d.toString();
      byTarget.set(key, byTarget.has(key) ? null : row.positionId);
    }
  }
  let serial = 1;
  for (const row of rows) {
    const v = readMm(row.rawMm, "rawMm", []);
    const target = v && (g.origin && g.step && g.step.n > 0n ? quantize(v.d, g.origin, g.step) : v.d);
    const key = target?.toString();
    const match = key && byTarget.get(key);
    if (match) {
      row.positionId = match;
      byTarget.delete(key!);
    } else {
      while (reserved.has("plan-" + serial)) serial++;
      row.positionId = "plan-" + serial++;
      reserved.add(row.positionId);
    }
  }
}
