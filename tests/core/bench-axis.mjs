/** Run after npm run build. Uses the published P05 generator and independent 06 certificates. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { calculateAxis, demoProfile } from "../../dist/axis.js";
import { fixtureRequest } from "./fixture-input.ts";
import { bits, positionBits } from "./observed-bits.ts";

const oracle = fileURLToPath(new URL("./axis_oracle.py", import.meta.url));
const measurements = [];
for (const m of [5, 6, 12, 100, 1000]) {
  const ref = JSON.parse(
    execFileSync("python", ["-B", oracle, "--p05-reference", String(m)], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const req = fixtureRequest(ref.fixture, demoProfile);
  const samples = [];
  for (let i = 0; i < 4; i++) {
    req.runId = req.trialId + "/" + i;
    const start = performance.now();
    const result = await calculateAxis(req);
    const elapsed = performance.now() - start;
    assert.equal(result.state, "research-computed");
    if (i > 0) samples.push(Number(elapsed.toFixed(3)));
    assert.deepEqual(
      Object.fromEntries(Object.entries(result.axis).map(([k, x]) => [k, bits(x)])),
      ref.totals,
    );
    assert.equal(result.positions.length, m);
    const order = new Map(req.inputs.positions.map((p, index) => [p.positionId, index]));
    for (const pos of result.positions) {
      assert.deepEqual(positionBits(pos), ref.positions[pos.positionId].fields);
      const names = { cross: "C_i", up: "R_i_up", down: "R_i_down" };
      assert.deepEqual(
        pos.activeCandidates.map((k) => names[k]),
        ref.positions[pos.positionId].branches,
      );
    }
    assert.equal(Object.keys(result.extrema).length, 18);
    for (const [kind, sources] of Object.entries(ref.sources))
      assert.deepEqual(
        result.extrema[kind],
        sources.map((s) => ({
          kind,
          positionId: s.position_id,
          direction: s.direction,
          positionOrder: order.get(s.position_id),
        })),
      );
  }
  measurements.push({
    positions: m,
    observations: 10 * m,
    certifiedFields: 20 * m + 12,
    timesMs: samples,
    medianMs: [...samples].sort((a, b) => a - b)[1],
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      warmupsPerSize: 1,
      measurements,
    },
    null,
    2,
  ),
);
