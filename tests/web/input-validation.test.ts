import { describe, expect, it } from "vitest";
import { checkAxisInputs } from "../../src/core/axis";
import { draft, editorPosition } from "../../src/web/model";
import { classify, inspectInputs } from "../../src/web/inputValidation";

describe("numeric entry", () => {
  it.each(["0", "5", "-5", "+5", "0,125", "0.125", "-0,0010", ".5", "1e-12", "-2.5E+3", " −5 ", "0,", "0." ])
  ("accepts the complete source %j", raw => {
    expect(classify(raw, "um").state).toBe("valid-numeric");
  });
  it.each(["abc", "д", "текст", "1,2,3", "1.2.3", "12abc", "NaN", "Infinity", "1 234", "  "])
  ("rejects the entire source %j", raw => {
    expect(classify(raw, "mm", true).state).toBe("invalid-format");
  });
  it.each(["-", "+", ".", ",", "−.", "0,", "1e", "1e-", "-.5E+"])
  ("recognizes the unfinished entry %j only while typing", raw => {
    expect(classify(raw, "um", true).state).toBe("editing");
    expect(classify(raw, "um").state).toBe(raw === "0," ? "valid-numeric" : "invalid-format");
  });
  it.each(["", null])("reports %j as missing", raw => {
    expect(classify(raw, "um").state).toBe("empty");
  });
  it.each([["1e-400", "input-nonzero-to-zero"], ["1e400", "input-nonfinite"],
    ["1e4097", "decimal-resource-limit"], ["0".repeat(4097), "decimal-resource-limit"]])
  ("preserves the reason for a numerical refusal (case %#)", (raw, reason) => {
    expect(classify(raw, "um", true)).toMatchObject({ state: "numeric-rejected", message: expect.stringContaining(reason) });
  });
  it("accepts the inclusive length limit", () => {
    expect(classify("0".repeat(4096), "mm").state).toBe("valid-numeric");
  });
  it("counts seven positions independently of their coordinates and follows row changes", () => {
    const inputs = draft(false).inputs;
    const rows = [...inputs.positions, editorPosition("p06"), editorPosition("p07")];
    inputs.positions = rows;
    const cells = [...rows[0].observations.up, ...rows[0].observations.down];
    ["д", "abc", "текст", "NaN", "Infinity", "12abc", "5", "5"].forEach((s, i) => { cells[i].raw = s; });
    const review = inspectInputs(inputs);
    expect(review.counts).toEqual({ valid: 2, empty: 62, format: 6, rejected: 0, editing: 0 });
    expect(review.coordinates).toBe(0);
    expect(review.problems).toHaveLength(75);
    expect(review.problems[0].id).toBe("p01-raw-up-1");
    expect(review.problems[6].id).toBe("p01-targetMm");
    rows[0].targetMm = "0";
    cells[0].raw = "0";
    inputs.positions = rows.slice(0, -1);
    expect(inspectInputs(inputs)).toMatchObject({ counts: { valid: 3, empty: 52, format: 5 }, coordinates: 1 });
  });
  it("attaches a collision reported by the axis to the indicated repeat", () => {
    const inputs = draft(true).inputs;
    inputs.positions[0].observations.up[0].raw = "1";
    inputs.positions[2].observations.down[1].raw = "1.00000000000000001";
    const gate = checkAxisInputs(inputs);
    if (gate.valid) throw Error("Expected a collision");
    const result = inspectInputs(inputs, undefined, gate.issue.diagnostic("test"));
    expect(result.counts).toMatchObject({ valid: 49, rejected: 1, format: 0 });
    expect(result.problems[0]).toMatchObject({ id: "p03-raw-down-2", message: expect.stringContaining("input-collision") });
  });
});
