import { Database } from "@db/sqlite";
import type { CurvePoint } from "./types.ts";
import { listCurves, createCurve } from "./curves.ts";
import { activateCurve } from "./activations.ts";

export const SCREENSHOT_CURVE_NAME = "tristar-screenshot-2026-04-08";

// Values read from curve.png. The 135V row was unreadable in the
// screenshot and is omitted; the operator can edit the seed curve to
// add it after first run.
export const SCREENSHOT_POINTS: CurvePoint[] = [
  { voltage: 49.5, power: 2 },
  { voltage: 60.0, power: 10 },
  { voltage: 70.0, power: 20 },
  { voltage: 75.0, power: 30 },
  { voltage: 80.0, power: 40 },
  { voltage: 85.0, power: 60 },
  { voltage: 90.0, power: 100 },
  { voltage: 95.0, power: 150 },
  { voltage: 100.0, power: 250 },
  { voltage: 105.0, power: 400 },
  { voltage: 110.0, power: 600 },
  { voltage: 115.0, power: 1000 },
  { voltage: 120.0, power: 1500 },
  { voltage: 125.0, power: 2000 },
  { voltage: 130.0, power: 3000 },
  { voltage: 140.0, power: 5000 },
];

/**
 * If no curves exist, insert the seed curve from curve.png and open an
 * activation row at `activationStartTs` (the earliest known sample ts,
 * or now if the samples table is also empty).
 */
export function seedIfEmpty(db: Database, activationStartTs: number): void {
  if (listCurves(db).length > 0) return;
  const id = createCurve(db, {
    name: SCREENSHOT_CURVE_NAME,
    notes: "Imported from curve.png. The 135V row was unreadable in the screenshot — edit if known.",
    source: "imported",
    points: SCREENSHOT_POINTS,
  });
  activateCurve(db, id, activationStartTs, "auto-seeded on first boot");
}
