import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateAxis } from "../../src/core/axis";
import { diagnosticAddress, diagnosticTarget, draft, travelEntry } from "../../src/web/model";
import { Plot, Report } from "../../src/web/Results";

describe("demo presentation", () => {
  it.each([
    ["abc", "не подтверждён"], ["1e-400", "не подтверждён"], ["−1", "не подтверждён"],
    ["", "не указан"], ["1000,000", "1000,000 мм"],
  ])("renders full travel %j", (raw, label) => {
    expect(travelEntry(raw).label).toBe(label);
  });

  it("links a derived variance to its series and a missing observation to its repeat", () => {
    const address = { field: "variance", positionId: "p03", direction: "down" } as const;
    expect(diagnosticTarget(address)).toBe("p03-raw-down-1");
    expect(diagnosticAddress(address)).toContain("↓ down");
    expect(diagnosticTarget({ ...address, field: "raw", repeat: 5 })).toBe("p03-raw-down-5");
    expect(diagnosticTarget({ field: "positions" })).toBe("positions");
  });

  it.each([
    ["20", "0", ""],
    ["0", "0", "Все шесть рядов совпадают на 0 мкм."],
    ["2", "2", "Все шесть рядов совпадают в каждой позиции."],
  ])("explains the current curves for %s / %s", async (special, background, caption) => {
    const request = draft(true);
    for (const p of request.inputs.positions)
      for (const values of Object.values(p.observations))
        for (const o of values) o.raw = background;
    request.inputs.positions[2].observations.up[4].raw = special;
    const r = await calculateAxis(request);
    if (r.state !== "research-computed") throw Error(r.state);
    const svg = renderToStaticMarkup(<Plot positions={r.positions} selected="p03" select={() => {}} />);
    expect(svg.match(/<polyline/g)).toHaveLength(6);
    if (caption) expect(svg).toContain(caption);
    else expect(svg).not.toContain("Все шесть рядов совпадают");
  });

  it("retains 12 arithmetic results in a preliminary report with unconfirmed travel", async () => {
    const req = draft(true);
    req.inputs.axis.fullTravelMm = "abc";
    const r = await calculateAxis(req);
    if (r.state !== "research-computed") throw Error(r.state);
    const report = renderToStaticMarkup(<Report result={r} req={req} generated={new Date(0)} />);
    expect(report).toContain("не подтверждён");
    expect(report).not.toContain("abc мм");
    expect(report.match(/data-metric=/g)).toHaveLength(12);
    expect(r.axis.Bbar).toBe(0.8);
  });
});
