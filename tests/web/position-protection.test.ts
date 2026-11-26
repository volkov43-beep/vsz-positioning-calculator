import { expect, it } from "vitest";
import { snapshotDigest } from "../../src/core/snapshot";
import { hasEnteredObservations } from "../../src/planning/changes";
import { draft, editorPosition } from "../../src/web/model";
import { blockedPositionEdit } from "../../src/web/planModel";

function trial(coordinate: string, raw: string | null) {
  const inputs = draft(false).inputs;
  const row = editorPosition("p03", coordinate);
  row.observations.down[3].raw = raw;
  return { ...inputs, positions: [row] };
}

it.each(["", null])("allows a move or removal with only empty records (%j)", raw => {
  const old = trial("250", raw);
  expect(hasEnteredObservations(old.positions[0])).toBe(false);
  expect(blockedPositionEdit(old, trial("300", raw))).toBeNull();
  expect(blockedPositionEdit(old, { ...old, positions: [] })).toBeNull();
});

it.each(["0", "-0,00100", "abc", "1e-", " "])("protects entered source %j even if cleared in the candidate", raw => {
  const old = trial("250", raw);
  expect(blockedPositionEdit(old, trial("300", ""))).toEqual({ reason: "target", positionId: "p03" });
  expect(blockedPositionEdit(old, { ...old, positions: [] })).toEqual({ reason: "remove", positionId: "p03" });
  expect(old.positions[0].observations.down[3].raw).toBe(raw);
  expect(blockedPositionEdit(old, trial("250", "0"))).toBeNull();
});

it.each([["40.0","40.00"], ["−0,0400","-4e-2"], ["+0.000","-0"]])("permits exact equivalents %s → %s as distinct input snapshots", async (from,to) => {
  const old = trial(from, "-0,00100"), next = trial(to, "-0,00100");
  expect(blockedPositionEdit(old,next)).toBeNull();
  expect(await snapshotDigest(next)).not.toBe(await snapshotDigest(old));
  expect(next.positions[0].observations).toEqual(old.positions[0].observations);
});

it.each([["1","1.00000000000000001"], ["40","4e-"], ["","40"], ["abc","40"], ["1e-400","0"]])("refuses unproved identity %s → %s", (from,to) => {
  const old = trial(from,"0");
  expect(blockedPositionEdit(old, trial(to,"0"))?.reason).toBe("target");
  expect(blockedPositionEdit(old, trial(from,"1"))).toBeNull();
});

it("matches by unique ID, allows reordering and protects both series of a full position", () => {
  const old = draft(true).inputs;
  const preserved = structuredClone(old);
  const row = old.positions[2];
  expect(blockedPositionEdit(old, { ...old, positions: [...old.positions].reverse() })).toBeNull();
  const moved = { ...row, targetMm: "300" };
  expect(blockedPositionEdit(old, { ...old, positions: old.positions.map(p => p === row ? moved : p) })?.reason).toBe("target");
  expect(blockedPositionEdit(old, { ...old, positions: [moved, ...old.positions] })?.reason).toBe("target");
  expect(blockedPositionEdit(old, { ...old, positions: old.positions.map(p => p === row ? { ...row, positionId: "p06" } : p) })?.reason).toBe("remove");
  expect(old).toEqual(preserved);
});
