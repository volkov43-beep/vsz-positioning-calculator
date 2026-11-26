import type { Q } from "../core/rational";
import { decimalString, quantize, readMm } from "./decimal";
import type { Geometry } from "./geometry";
import { issue, type ExecutableRow, type Finding, type PlanRequest, type PlanRow } from "./types";

function checkCoordinates(values: (ReturnType<typeof readMm>)[], stage: "rawMm" | "executableMm", g: Geometry, findings: Finding[]) {
  const exact = new Map<string, number>();
  const machine = new Map<string, number>();
  const address = (i: number) => "positions[" + i + "]." + stage;
  for (const [i, v] of values.entries()) {
    if (!v) continue;
    const first = exact.get(v.normalized);
    const sameBits = machine.get(v.bits);
    if (first !== undefined)
      findings.push(issue("error", stage === "rawMm" ? "COORD_DUP" : "GRID_DUP", "Две координаты совпали.", address(first), address(i)));
    else if (sameBits !== undefined)
      findings.push(issue("error", "COORD_COLLISION", "Разные десятичные координаты имеют одно представление binary64.", address(sameBits), address(i)));
    if (first === undefined) exact.set(v.normalized, i);
    if (sameBits === undefined) machine.set(v.bits, i);
    const prev = values[i - 1];
    if (prev && prev.d.cmp(v.d) > 0)
      findings.push(issue("error", "COORD_ORDER", "Координаты следуют в обратном порядке.", address(i - 1), address(i)));
    if ((g.min && v.d.cmp(g.min) < 0) || (g.max && v.d.cmp(g.max) > 0))
      findings.push(issue("error", "MECHANICAL_LIMIT", "Цель вне доступных пределов движения.", address(i), "passport.limits"));
    if ((g.start && v.d.cmp(g.start) < 0) || (g.end && v.d.cmp(g.end) > 0))
      findings.push(issue("error", "SECTION_BOUND", "Цель вне измерительного участка.", address(i), "section"));
  }
}

export function coordinates(r: PlanRequest, rows: PlanRow[], g: Geometry, findings: Finding[]) {
  const ids = new Map<string, number>();
  const raw = rows.map((row, i) => {
    const path = "positions[" + i + "]";
    const prior = ids.get(row.positionId);
    if (!row.positionId.trim()) findings.push(issue("error", "ID_EMPTY", "Требуется ID позиции.", path + ".positionId"));
    else if (prior !== undefined) findings.push(issue("error", "ID_DUP", "ID позиции повторён.", "positions[" + prior + "].positionId", path + ".positionId"));
    else ids.set(row.positionId, i);
    if (row.origin === "edited-proposal" && !row.originalProposalMm?.trim())
      findings.push(issue("error", "ORIGIN_MISSING", "Сохраните исходную предложенную координату.", path + ".originalProposalMm"));
    return readMm(row.rawMm, path + ".rawMm", findings);
  });
  checkCoordinates(raw, "rawMm", g, findings);
  const gridReady = g.step && g.step.n > 0n && g.origin && r.grid?.rounding === "nearest-ties-away-from-origin";
  const final = gridReady ? raw.map((v, i) => {
    if (!v) return null;
    const q = quantize(v.d, g.origin!, g.step!);
    if (q.cmp(v.d) === 0) return v;
    return readMm(decimalString(q), "positions[" + i + "].executableMm", findings);
  }) : r.grid ? raw.map(() => null) : raw;
  if (gridReady) checkCoordinates(final, "executableMm", g, findings);
  if (rows.length) {
    for (const side of ["left", "right"] as const) {
      const i = side === "left" ? 0 : rows.length - 1;
      const end = g[side];
      if (end && raw[i] && end.cmp(raw[i]!.d) !== 0)
        findings.push(issue("error", "END_MISMATCH", "Крайняя координата отличается от указанной в запросе.", "ends." + side, "positions[" + i + "].rawMm"));
      if (end && gridReady && r.ends[side].status === "agreed" && final[i] && end.cmp(final[i]!.d) !== 0)
        findings.push(issue("error", "AGREED_END_MOVED", "Сетка изменяет согласованную крайнюю цель.", "ends." + side, "positions[" + i + "].executableMm"));
    }
  }
  const gaps: (Q | null)[] = [];
  for (let i = 1; i < final.length; i++) {
    const a = final[i - 1], b = final[i];
    gaps.push(a && b ? b.d.sub(a.d) : null);
  }
  const positions: ExecutableRow[] = rows.map((row, i) => ({
    ...row, order: i + 1, executableMm: gridReady ? final[i]?.raw ?? null : null,
  }));
  const first = final[0]?.d, last = final.at(-1)?.d;
  return { positions, gaps, first, last, spanMm: first && last ? decimalString(last.sub(first)) : null };
}
