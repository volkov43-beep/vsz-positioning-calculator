import type { AxisInputs, AxisRequest } from "../../src/core/axis";
import type { PositionInput } from "../../src/core/contracts";

type RawSeries = { repeat: number; value?: unknown }[];
export interface Fixture {
  case_id: string;
  schema_version: string;
  profile_id: string;
  sd_method: string;
  units: { coordinate: string; deviation: string };
  positions: ({ position_id: string; target_mm: string } & Record<string, unknown>)[];
  context: { full_travel_mm: string; missing_report_fields?: string[] };
}

/** Test boundary for vsz-fixtures-1.0. Preserve bad source values for the real validator. */
export function fixtureRequest(data: Fixture, profile: AxisInputs["profile"]): AxisRequest {
  if (
    data.schema_version !== "vsz-fixtures-1.0" ||
    data.profile_id !== profile.profileId ||
    data.sd_method !== profile.sdMethod ||
    data.units.coordinate !== "mm"
  )
    throw new Error("Unsupported fixture schema, profile, method or coordinate unit");
  const positions = data.positions.map((row) => {
    const observations: Record<string, unknown> = {};
    for (const [direction, entries] of Object.entries(row)) {
      if (["position_id", "target_mm", "expected", "exact"].includes(direction)) continue;
      if (!Array.isArray(entries)) continue;
      observations[direction] = (entries as RawSeries).map((entry) => ({
        repeat: entry.repeat,
        sourceUnit: data.units.deviation,
        ...(Object.hasOwn(entry, "value") ? { raw: entry.value } : {}),
      }));
    }
    // Invalid fixture records may intentionally omit a direction or raw value.
    return { positionId: row.position_id, targetMm: row.target_mm, observations } as PositionInput;
  });
  return {
    origin: { kind: "synthetic", sourceId: data.case_id },
    trialId: data.case_id,
    runId: data.case_id + "/1",
    inputRevision: 1,
    inputs: {
      profile,
      axis: { kind: "linear", name: "X", fullTravelMm: data.context.full_travel_mm },
      positions,
    },
    missingReportFields: [...(data.context.missing_report_fields ?? [])],
  };
}
