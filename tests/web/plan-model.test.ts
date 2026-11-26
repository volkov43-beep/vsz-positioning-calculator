import { expect, it } from "vitest";
import { snapshotDigest } from "../../src/core/snapshot";
import { exampleRows, validate } from "../../src/planning";
import { draft } from "../../src/web/model";
import { activeTrial, freshSession, guardCurrent, passport, planRequest, teachingAxisMismatch, teachingForm } from "../../src/web/planModel";

it("keeps passport length independent from confirmation, section, endpoints and limits", async () => {
  const r = draft(false); r.inputs.axis.fullTravelMm = "1500";
  const s = freshSession(); const q = await planRequest(activeTrial(r,s),s.form);
  expect(q.passport).toMatchObject({ fullTravelMm:"1500", travelConfirmed:false, limits:null });
  expect(q.section.startMm).toBeNull(); expect(q.ends.right.rawMm).toBeNull();
  expect(q.base.inputDigest).toBe(await snapshotDigest(r.inputs));
});
it("binds proposed rows to the actual immutable input object, revision and conditions at commit time", async () => {
  const r = draft(false), s = freshSession(), a = activeTrial(r,s);
  const { base } = await planRequest(a,s.form);
  expect(guardCurrent(r,s,a,base)).toBe(true);
  expect(guardCurrent({ ...r,inputs:structuredClone(r.inputs) },s,a,base)).toBe(false);
  expect(guardCurrent({ ...r,inputRevision:r.inputRevision+1 },s,a,base)).toBe(false);
  expect(guardCurrent(r,{...s,serial:s.serial+1},a,base)).toBe(false);
  expect(guardCurrent({ ...r,trialId:"other" },s,a,base)).toBe(false);
});
it("uses an independent teaching context without writing to the trial or inheriting T06", async () => {
  const r = draft(true), before = structuredClone(r), s = freshSession();
  const q = await planRequest(activeTrial(r,s),teachingForm()); const p = await validate(q,exampleRows);
  expect(p.positions.map(row=>row.rawMm)).toEqual(["40.000","261.250","493.000","740.500","960.000"]);
  expect(p.reversal.left.state).toBe("unconfirmed"); expect(r).toEqual(before);
  expect(passport(r.inputs.axis,s.form).travelConfirmed).toBe(false);
});
it("keeps the teaching example from replacing a different physical passport", async () => {
  const r = draft(false), s = freshSession(); const q = await planRequest(activeTrial(r,s),teachingForm());
  const p = await validate(q,exampleRows);
  for (const raw of ["1500","2000,0001","abc"]) expect(teachingAxisMismatch({...r.inputs.axis,fullTravelMm:raw},p,true)).toBe(true);
  expect(teachingAxisMismatch({...r.inputs.axis,fullTravelMm:"1e3"},p,true)).toBe(false);
});
