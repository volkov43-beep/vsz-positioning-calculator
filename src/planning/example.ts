import type { PlanRow } from "./types";

// Standalone teaching plan from MEETING-01; it contains no observations.
export const exampleRows: readonly PlanRow[] = ["40.000", "261.250", "493.000", "740.500", "960.000"].map((rawMm, i) => ({
  positionId: "plan-x-0" + (i + 1), rawMm, origin: "proposed",
}));
