import { expect, it } from "vitest";
import { calculateAxis } from "../../src/core/axis";
import { snapshotDigest } from "../../src/core/snapshot";
import { draft, editorPosition } from "../../src/web/model";
import { editCoordinate, exampleRows, prepareApply, previewChanges, propose, validate, type PlanRow } from "../../src/planning";
import { trial } from "./sample";

it("prepares 50 independent empty observation addresses without writing to the trial", async () => {
  const { r, active } = await trial(); const before = structuredClone(active);
  const p = await propose(r); const preview = previewChanges(active, p);
  expect(preview.positions.every(c => c.kind === "added")).toBe(true);
  const op = await prepareApply(active, p, p.version);
  expect(active).toEqual(before); expect(op.state).toBe("ready");
  if (op.state !== "ready") throw Error(op.state);
  const addresses = op.inputs.positions.flatMap(row => (["up", "down"] as const).flatMap(d =>
    row.observations[d].map(obs => [row.positionId, d, obs.repeat, obs.raw, obs.sourceUnit].join("/"))));
  expect(new Set(addresses).size).toBe(50); expect(addresses.every(k => k.endsWith("//um"))).toBe(true);
  expect(op.receipt.inputRevision).toBe(2);
  expect(op.receipt.inputDigest).toBe(await snapshotDigest(op.inputs));
  const replay = { ...active, inputRevision: 2, inputs: op.inputs, lastApplied: op.receipt };
  expect((await prepareApply(replay, p, p.version)).state).toBe("already-applied");
  expect((await prepareApply({ ...replay, inputRevision: 3 }, p, p.version)).state).toBe("conflict");
});

it("preserves exact raw, unit and addressed repeat when only the spelling changes", async () => {
  const row = editorPosition("plan-x-01", "40.0"); row.observations.down = [{ raw: "−0,00500", sourceUnit: "mm", repeat: 4 }];
  const { r, active } = await trial([row]);
  const p = await validate(r, exampleRows); const op = await prepareApply(active, p, p.version);
  expect(op.state).toBe("ready"); if (op.state !== "ready") throw Error(op.state);
  expect(op.changes[0].kind).toBe("reformatted");
  expect(op.inputs.positions[0].observations).toEqual(row.observations);
  expect(op.inputs.positions[0].observations).not.toBe(row.observations);
  expect(op.inputs.positions[0].targetMm).toBe("40.000");
});

it.each(["0", "-0,0000", "пока текст", " "])("protects partial or unsettled input %j on both movement and deletion", async value => {
  const kept = editorPosition("plan-x-02", "260"); kept.observations.up = [{ raw: value, sourceUnit: "um", repeat: 5 }];
  const removed = editorPosition("old", "100"); removed.observations.down = [{ raw: "-1e-12", sourceUnit: "mm", repeat: 2 }];
  const { r, active } = await trial([kept, removed]); const before = structuredClone(active);
  const p = await validate(r, exampleRows); const op = await prepareApply(active, p, p.version);
  if (op.state !== "requires-preservation") throw Error(op.state);
  expect(op.changes.filter(c => c.requiresPreservation)).toMatchObject([
    { kind: "moved", positionId: "plan-x-02", oldMm: "260", newMm: "261.250", observations: [{ direction: "up", repeat: 5, raw: value, sourceUnit: "um" }] },
    { kind: "removed", positionId: "old", observations: [{ direction: "down", repeat: 2, raw: "-1e-12", sourceUnit: "mm" }] },
  ]);
  expect(op).not.toHaveProperty("inputs"); expect(active).toEqual(before);
});

it("does not transfer measurements to a new ID at the same coordinate", async () => {
  const row = editorPosition("other-id", "40.000", ["0"]);
  const { r, active } = await trial([row]); const p = await validate(r, exampleRows);
  expect((await prepareApply(active, p, p.version)).state).toBe("requires-preservation");
});

it("compares the executed coordinate, including a grid shift of the original measured target", async () => {
  const row = editorPosition("plan-x-02", "261.250", ["1"]);
  const { r, active } = await trial([row]); r.grid = { originMm: "0", stepMm: "1", rounding: "nearest-ties-away-from-origin" };
  const p = await validate(r, exampleRows); const op = await prepareApply(active, p, p.version);
  expect(op.state).toBe("requires-preservation");
});

it("previews reordering with the original ID and observation; an empty old target can move", async () => {
  const measured = editorPosition("plan-x-01", "40.000", ["-2"]);
  const { r, active } = await trial([editorPosition("plan-x-02","210"), measured]);
  const p = await validate(r, exampleRows); const op = await prepareApply(active, p, p.version);
  if (op.state !== "ready") throw Error(op.state);
  expect(op.changes.map(c => c.kind).slice(0,2)).toEqual(["reordered","moved"]);
  expect(op.inputs.positions[0].observations.up[0].raw).toBe("-2");
  expect(op.inputs.positions[1].observations.up.every(o => o.raw === "")).toBe(true);
});

it.each(["trialId", "inputRevision", "inputDigest", "conditionsVersion", "version", "coordinate", "executed"] as const)("rejects stale %s", async key => {
  const { r, active } = await trial(); const p = await propose(r); let version = p.version;
  if (key === "trialId") active.trialId = "different";
  if (key === "inputRevision") active.inputRevision++;
  if (key === "conditionsVersion") active.conditionsVersion = "c2";
  if (key === "inputDigest") active.inputs.axis.name = "Y";
  if (key === "version") version = "old";
  if (key === "coordinate") p.positions[2].rawMm = "462";
  if (key === "executed") p.positions[2].executableMm = "462";
  expect((await prepareApply(active, p, version)).state).toBe("conflict");
});

it("retains all ten measurements and permits only a report reassessment for conditions-only changes", async () => {
  const positions = exampleRows.map(row => editorPosition(row.positionId, row.rawMm, ["0","1","2","3","4"], ["0","-1","-2","-3","-4"]));
  const { r, active } = await trial(positions); const before = structuredClone(active.inputs);
  const first = await validate(r, exampleRows);
  active.conditionsVersion = r.base.conditionsVersion = "rechecked";
  r.section.approach.left.basis = "новая проверка участка";
  const p = await validate(r, exampleRows);
  expect(first.version).not.toBe(p.version);
  const op = await prepareApply(active, p, p.version);
  if (op.state !== "unchanged-inputs") throw Error(op.state);
  expect(op).toMatchObject({ invalidateArithmetic: false, reassessReport: true, receipt: { inputRevision: 1, inputDigest: r.base.inputDigest } });
  expect(op.inputs).toEqual(before);
});

it("restoring identical strings returns the old digest in a later revision", async () => {
  const { r, active } = await trial(exampleRows.map(row => editorPosition(row.positionId, row.rawMm)));
  const rows = exampleRows.map((row,i) => i ? row : editCoordinate(row,"40.0"));
  const p = await validate(r, rows); const op = await prepareApply(active, p, p.version);
  if (op.state !== "ready") throw Error(op.state);
  const current = { ...active, inputs: op.inputs, inputRevision: 2, lastApplied: op.receipt };
  const undo = await validate({ ...r, base: op.receipt }, exampleRows);
  const restored = await prepareApply(current, undo, undo.version);
  if (restored.state !== "ready") throw Error(restored.state);
  expect(restored.receipt).toMatchObject({ inputRevision: 3, inputDigest: r.base.inputDigest });
});

it("blocks ambiguous original identities and respects a rejected review", async () => {
  const { r, active } = await trial([editorPosition("old"), editorPosition("old")]);
  const p = await validate(r, exampleRows);
  expect((await prepareApply(active, p, p.version)).state).toBe("conflict");
  const rejected = await validate(r, exampleRows, { proposalVersion: p.version, decision: "rejected", basis: "проверка", conditions: ["реверс"] });
  expect((await prepareApply(active, rejected, p.version)).state).toBe("blocked");
});

it("leaves legacy T06 inputs intact, protects its unknown frame and keeps the old manual calculation available", async () => {
  const sample = draft(true); const old = structuredClone(sample.inputs);
  const { r, active } = await trial(sample.inputs.positions);
  r.passport.limits = null; r.section.startMm = r.ends.left.rawMm = "0"; r.section.endMm = r.ends.right.rawMm = "1000";
  r.section.choice = "fixed"; r.section.constraints = ["исторический синтетический пример"];
  const rows: PlanRow[] = sample.inputs.positions.map(row => ({ positionId: row.positionId, rawMm: row.targetMm, origin: "manual" }));
  const p = await validate(r, rows);
  active.frame = null;
  expect((await prepareApply(active, p, p.version)).state).toBe("requires-preservation");
  expect(sample.inputs).toEqual(old);
  const result = await calculateAxis({ ...sample, inputs: { ...sample.inputs, axis: { ...sample.inputs.axis, fullTravelMm: null } } });
  if (result.state !== "research-computed") throw Error(result.state);
  expect(result.axis.B).toBe(4); expect(result.axis.Bbar).toBe(0.8); expect(Object.keys(result.axis)).toHaveLength(12);
});

it("reuses IDs by final physical coordinate and reserves old IDs regardless of order", async () => {
  const { r, active } = await trial([editorPosition("original", "207", ["-3"]), editorPosition("plan-1", "10")]);
  r.grid = { originMm: "0", stepMm: "1", rounding: "nearest-ties-away-from-origin" };
  r.previousTargets = { axisName: "X", frame: active.frame, positions: active.inputs.positions.map(({positionId, targetMm}) => ({positionId, targetMm})) };
  const p = await propose(r);
  expect(p.positions[1]).toMatchObject({ positionId: "original", rawMm: "207.273", executableMm: "207" });
  expect(p.positions.map(row => row.positionId)).not.toContain("plan-1");
  expect((await prepareApply(active, p, p.version)).state).toBe("ready");
  r.previousTargets.frame = null;
  expect((await propose(r)).positions.map(row => row.positionId)).not.toContain("original");
});

it("invalidates outstanding arithmetic immediately upon a planned input edit even with the same trial", async () => {
  const { r, active } = await trial();
  const p = await propose(r);
  const op = await prepareApply(active, p, p.version);
  if (op.state !== "ready") throw Error(op.state);
  expect(op.invalidateArithmetic).toBe(true);
  expect(op.guard.inputRevision).toBe(1);
  expect(op.receipt.inputRevision).toBe(2);
});

it("exposes a passport edit in preview and updates the arithmetic digest once", async () => {
  const { r, active } = await trial();
  r.passport.fullTravelMm = "1500";
  const p = await propose(r);
  expect(previewChanges(active, p).fullTravel).toEqual({ oldMm: "1000", newMm: "1500" });
  const op = await prepareApply(active, p, p.version);
  if (op.state !== "ready") throw Error(op.state);
  expect(op.inputs.axis.fullTravelMm).toBe("1500"); expect(active.inputs.axis.fullTravelMm).toBe("1000");
});

it("the existing current-result gate rejects an older successful run after a prepared edit", async () => {
  const { isCurrentAxisResult } = await import("../../src/core/axis");
  const { r, active } = await trial(exampleRows.map(row => editorPosition(row.positionId, row.rawMm, Array(5).fill("1"), Array(5).fill("0"))));
  const attempt = { trialId: active.trialId, inputRevision: 1, runId: "original", inputs: active.inputs,
    origin: { kind: "synthetic" as const, sourceId: "planner-qa" } };
  const original = await calculateAxis(attempt);
  expect(await isCurrentAxisResult(original, attempt)).toBe(true);
  const p = await validate(r, exampleRows.map((row,i) => i === 1 ? editCoordinate(row,"261.25") : row));
  const op = await prepareApply(active, p, p.version);
  if (op.state !== "ready") throw Error(op.state);
  expect(await isCurrentAxisResult(original, { ...attempt, inputs: op.inputs, inputRevision: op.receipt.inputRevision })).toBe(false);
  expect(await isCurrentAxisResult(original, attempt)).toBe(true);
});
