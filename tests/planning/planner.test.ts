import { describe, expect, it } from "vitest";
import { editCoordinate, exampleRows, maxPositions, propose, recommendCount, validate } from "../../src/planning";
import { manual, request } from "./sample";

describe("full-travel density (Proposed)", () => {
  it.each([
    ["500", 5], ["800", 5], ["1000", 5], ["1000,0001", 6], ["1200", 6], ["1500", 8], ["2000", 10],
    ["1e3", 5], ["1200.00000000000000001", 7], ["1199.99999999999999999", 6], ["0.001", 5],
  ])("counts positions at %s mm", (raw, expected) => {
    const p = request().passport;
    p.fullTravelMm = String(raw);
    expect(recommendCount(p)).toMatchObject({ minimum: expected, profile: { state: "short" } });
  });
  it.each([null, "", "   ", "0", "-1", "abc", "1e309", "1e-500", "8".repeat(4097)])("requires a usable length %#", async raw => {
    const r = request();
    r.passport.fullTravelMm = raw;
    const p = await propose(r);
    expect(p.count).toBe(0);
    expect(p.state).toBe(raw == null || !raw.trim() ? "needs-input" : "refused");
    expect(p.recommendation.minimum).toBeNull();
    expect(p.findings.some(f => f.addresses.includes("passport.fullTravelMm"))).toBe(true);
  });
  it("keeps unconfirmed length separate from a valid manual structure", async () => {
    const r = request(); r.passport.travelConfirmed = false;
    const p = await validate(r, exampleRows);
    expect([p.structure.state, p.profile.state, p.state]).toEqual(["correct", "undetermined", "needs-input"]);
    expect((await propose(r)).count).toBe(0);
  });
  it("refuses just over 2000, including a length that rounds to 2000 in binary64", async () => {
    for (const raw of ["2000,0001", "2000.00000000000000001"]) {
      const r = request(); r.passport.fullTravelMm = raw;
      const p = await propose(r);
      expect([p.profile.state, p.state, p.count]).toEqual(["outside", "refused", 0]);
    }
  });
  it("uses 1500 mm even when the chosen section is 800 mm", async () => {
    const r = request(); r.passport.fullTravelMm = "1500"; r.section.endMm = r.ends.right.rawMm = "840";
    const p = await propose(r);
    expect(p).toMatchObject({ count: 8, sectionLengthMm: "800", recommendation: { fullTravelMm: "1500", minimum: 8 } });
    expect(p.intervalsMm).toHaveLength(7);
  });
});

describe("proposal and coordinate checks", () => {
  it("reproduces the weighted 2:3:4:2 plan with explicit endpoint spellings", async () => {
    const r = request();
    const p = await propose(r);
    expect(p.state).toBe("draft");
    expect(p.positions.map(row => row.rawMm)).toEqual(["40.000", "207.273", "458.182", "792.727", "960.000"]);
    expect(p.intervalsMm).toEqual(["167.273", "250.909", "334.545", "167.273"]);
    expect(p).toEqual(await propose(structuredClone(r)));
    expect((await validate(r, p.positions)).version).toBe(p.version);
    expect(p.rules.find(x => x.code === "GRID")?.state).toBe("unknown");
  });
  it("keeps manual edits and original proposals traceable", async () => {
    const r = request(); const p = await propose(r);
    const edited = p.positions.map((row, i) => i === 2 ? editCoordinate(editCoordinate(row, "460.00"), "459,20") : row);
    const next = await validate(r, edited);
    expect(next.positions[2]).toMatchObject({ origin: "edited-proposal", rawMm: "459,20", originalProposalMm: "458.182" });
    expect(next.version).not.toBe(p.version);
  });
  it("validates the separate teaching example without changing it", async () => {
    const p = await validate(request(), exampleRows);
    expect(p.intervalsMm).toEqual(["221.25", "231.75", "247.5", "219.5"]);
    expect(p).toMatchObject({ count: 5, state: "draft", targetSpanMm: "920", engineering: { state: "pending" } });
    expect(p.reversal.left).toMatchObject({ availableMm: "40", state: "unconfirmed" });
  });
  it("reports missing section and endpoint individually, without inferring them from travel", async () => {
    const r = request(); r.section.startMm = r.ends.left.rawMm = null;
    const p = await propose(r);
    expect(p.state).toBe("needs-input"); expect(p.count).toBe(0);
    expect(p.findings.flatMap(f => f.addresses)).toEqual(expect.arrayContaining(["section.startMm", "ends.left.rawMm"]));
  });
  it("accepts more positions, refuses an undersized or over-budget generation request", async () => {
    const r = request(); r.desiredCount = 12;
    expect((await propose(r)).count).toBe(12);
    for (const n of [4, 2.5, maxPositions + 1]) {
      r.desiredCount = n; expect((await propose(r)).state).toBe("refused");
    }
  });
  it.each([["0","20","40","60","80"], ["1","22","43","64","85"]])("detects constant final steps from %s", async (...coords) => {
    const { r, rows } = manual(coords);
    const p = await validate(r, rows);
    expect(p.rules).toContainEqual(expect.objectContaining({ code: "SPACING", state: "violated", addresses: ["positions[0]", "positions[4]"] }));
  });
  it.each(["fixed", "unknown"] as const)("keeps %s placement explicit", async choice => {
    const { r, rows } = manual(["0", "20", "40", "60", "80"]);
    r.section.choice = choice; r.section.constraints = ["учебная шкала"];
    expect((await propose(r)).state).toBe("needs-input");
    const p = await validate(r, rows);
    expect(p.rules.find(v => v.code === "SPACING")?.state).toBe(choice === "fixed" ? "not-applicable" : "unknown");
    expect(p.engineering.state).toBe("pending");
  });
  it.each([
    ["1.0", "1,00", "COORD_DUP"], ["1", "1.00000000000000001", "COORD_COLLISION"], ["1.1", "1", "COORD_ORDER"],
  ])("distinguishes coordinate conflict %s / %s", async (a, b, code) => {
    const { r, rows } = manual(["-2", a, b, "4", "6"]); const p = await validate(r, rows);
    expect(p.state).toBe("refused");
    expect(p.findings).toContainEqual(expect.objectContaining({ code, addresses: ["positions[1].rawMm", "positions[2].rawMm"] }));
  });
  it("locates both repeated IDs even when the coordinates differ", async () => {
    const r = request(); const rows = structuredClone([...exampleRows]); rows[2].positionId = rows[0].positionId;
    expect((await validate(r, rows)).findings).toContainEqual(expect.objectContaining({ code: "ID_DUP", addresses: ["positions[0].positionId", "positions[2].positionId"] }));
  });
  it("keeps exact negative coordinates, checks reversed section and real mechanical bounds", async () => {
    const { r, rows } = manual(["-95", "-73.13", "-40", "-10", "5"]);
    expect((await validate(r, rows)).state).toBe("draft");
    r.passport.limits = { minMm: "-90", maxMm: "300" };
    expect((await validate(r, rows)).findings.map(f => f.code)).toContain("MECHANICAL_LIMIT");
    r.section.endMm = "-101";
    expect((await validate(r, rows)).findings.map(f => f.code)).toContain("SECTION_ORDER");
  });
  it("rejects coarse interpolation and invalid algorithm or fixed precision", async () => {
    const r = request(); r.ends.right.rawMm = "40.01"; r.decimalPlaces = 0;
    expect((await propose(r)).state).toBe("refused");
    r.decimalPlaces = 13; expect((await propose(r)).findings.map(f => f.code)).toContain("PRECISION");
    r.algorithmVersion = "v0"; expect((await propose(r)).findings.map(f => f.code)).toContain("VERSION");
  });
});

describe("machine grid, reversal and review", () => {
  it("keeps both proposed coordinates and reports their shared executable tick", async () => {
    const { r, rows } = manual(["0", "10,001", "10,002", "22", "40"]);
    r.grid = { originMm: "0", stepMm: "0,01", rounding: "nearest-ties-away-from-origin" };
    const p = await validate(r, rows);
    expect(p.state).toBe("refused");
    expect(p.positions.slice(1, 3).map(x => [x.rawMm, x.executableMm])).toEqual([["10,001", "10"], ["10,002", "10"]]);
    expect(p.findings).toContainEqual(expect.objectContaining({ code: "GRID_DUP", addresses: ["positions[1].executableMm","positions[2].executableMm"] }));
  });
  it("detects uniformity created by quantization and keeps requested m", async () => {
    const { r, rows } = manual(["0", "9.99", "20.02", "30.01", "40"]);
    r.grid = { originMm: "0", stepMm: "1", rounding: "nearest-ties-away-from-origin" };
    const p = await validate(r, rows);
    expect(p.intervalsMm).toEqual(["10","10","10","10"]);
    expect(p.state).toBe("refused"); expect(p.count).toBe(5);
  });
  it("rounds both tie signs exactly relative to a nonzero origin", async () => {
    const { r, rows } = manual(["-1.025", "-0.005", "0.025", "0.041", "0.105"]);
    r.grid = { originMm: "0.005", stepMm: "0.02", rounding: "nearest-ties-away-from-origin" };
    const p = await validate(r, rows);
    expect(p.positions.map(x => x.executableMm)).toEqual(["-1.035","-0.015","0.025","0.045","0.105"]);
    r.ends.left.status = "agreed";
    expect((await validate(r, rows)).findings.map(f => f.code)).toContain("AGREED_END_MOVED");
  });
  it("checks limits again after snapping and rejects zero grid steps", async () => {
    const { r, rows } = manual(["-0.6", "1", "3", "6", "10"]);
    r.section.startMm = "-0.6";
    r.grid = { originMm: "0", stepMm: "1", rounding: "nearest-ties-away-from-origin" };
    expect((await validate(r, rows)).findings).toContainEqual(expect.objectContaining({ code: "SECTION_BOUND", addresses: ["positions[0].executableMm","section"] }));
    r.grid.stepMm = "0"; expect((await validate(r, rows)).state).toBe("refused");
  });
  it("refuses generation on a grid too coarse for the requested count", async () => {
    const r = request(); r.grid = { originMm: "0", stepMm: "1000", rounding: "nearest-ties-away-from-origin" };
    const p = await propose(r); expect(p.state).toBe("refused"); expect(p.count).toBe(5);
    expect(p.findings.map(f => f.code)).toContain("GRID_DUP");
  });
  it("checks each end independently; geometry cannot establish operational speed", async () => {
    const r = request(); r.section.approach.left = { bothSides: "possible", availableMm: "35", requiredMm: "30", basis: "учебный режим" };
    const p = await propose(r);
    expect(p.reversal.left).toMatchObject({ state: "geometry-checked", operatingSpeed: "requires-engineer", availableMm: "35" });
    expect(p.reversal.right.state).toBe("unconfirmed");
    r.section.approach.right.requiredMm = "41";
    expect((await propose(r)).reversal.right.state).toBe("contradiction");
  });
  it("detects an impossible physical approach even without a required margin", async () => {
    const r = request(); r.passport.limits!.maxMm = "960";
    expect((await propose(r)).reversal.right.state).toBe("contradiction");
    r.passport.limits = null; r.section.approach.left.bothSides = "impossible";
    expect((await propose(r)).state).toBe("refused");
  });
  it("binds listed confirmations and rejections to the specific proposal", async () => {
    const r = request(); const p = await validate(r, exampleRows);
    const review = { decision: "confirmed-listed" as const, proposalVersion: p.version, basis: "проверка примера", conditions: ["Согласование крайних позиций и охвата"] };
    const confirmed = await validate(r, exampleRows, review);
    expect(confirmed.engineering.state).toBe("confirmed-listed"); expect(confirmed.pendingConditions).toHaveLength(2);
    expect((await validate(r, exampleRows, { ...review, decision: "rejected" })).state).toBe("refused");
    r.base.conditionsVersion = "c2";
    expect((await validate(r, exampleRows, review)).engineering.state).toBe("pending");
  });
});

it("distinguishes an incomplete grid from an impossible one", async () => {
  const r = request(); r.grid = { stepMm: "0.1", originMm: null, rounding: "nearest-ties-away-from-origin" };
  const p = await propose(r);
  expect(p.state).toBe("needs-input"); expect(p.rules.find(c => c.code === "GRID")?.state).toBe("unknown");
});

it("reports invalid non-finite count without attempting to hash it as JSON", async () => {
  const r = request(); r.desiredCount = Infinity;
  expect(await propose(r)).toMatchObject({ state: "refused", version: "" });
});
it("keeps missing intervals at the actual adjacent pair", async () => {
  const { r, rows } = manual(["0", "", "4", "6", "10"]);
  const p = await validate(r, rows); expect(p.intervalsMm).toEqual([null, null, "2", "4"]);
});

it("checks declared overtravel against the actual mechanical space", async () => {
  const r = request();
  r.section.approach.left = { availableMm: "41", requiredMm: "10", bothSides: "possible", basis: "учебное условие" };
  const p = await propose(r);
  expect(p.reversal.left).toMatchObject({ availableMm: "40", state: "contradiction" });
  expect(p.state).toBe("refused");
});
