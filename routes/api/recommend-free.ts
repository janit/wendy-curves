import { getDb, getConfig } from "../../lib/state.ts";
import { getCurve } from "../../lib/curves.ts";
import { currentActivation } from "../../lib/activations.ts";
import { getSamplesInWindow } from "../../lib/db.ts";
import { analyze } from "../../lib/analyzer.ts";
import { suggestFreeCurve } from "../../lib/suggest-free.ts";
import { computeParasitic } from "../../lib/parasitic.ts";
import type { CurvePoint } from "../../lib/types.ts";

// Extrapolation fallback for the >observed voltage region.
// Derived from:
//   - Observed envelope in wendy's historical archive (2026-04-07/08 days,
//     ~116k TriStar samples) with 0.85 hotspot back-off applied:
//         108 V → 356 W, 110 V → 457 W, 112 V → 626 W, 115 V → 790 W
//   - User's domain anchor: peak observed power ~3 kW at ~160 V (rare, high wind)
//   - Smooth monotonic interpolation between the two regions.
// See docs/superpowers/notes/2026-04-09-curve-analysis-snapshot2.md for the
// full analysis. Revise when a windy day gives us direct data above 115 V.
const REALISTIC_EXTRAPOLATION: CurvePoint[] = [
  { voltage: 108, power: 360 },
  { voltage: 115, power: 790 },
  { voltage: 130, power: 1680 },
  { voltage: 145, power: 2450 },
  { voltage: 160, power: 3000 },
];

export const handler = {
  async POST(ctx: { req: Request }) {
    const body = await ctx.req.json().catch(() => ({})) as { tsFrom?: number; tsTo?: number };
    const db = getDb();
    const cfg = getConfig();
    const act = currentActivation(db);
    if (!act) return new Response("no active curve", { status: 409 });
    const curve = getCurve(db, act.curveId);
    if (!curve) return new Response("active curve missing", { status: 500 });

    const tsFrom = body.tsFrom ?? act.tsFrom;
    const tsTo = body.tsTo ?? Math.floor(Date.now() / 1000);
    const samples = getSamplesInWindow(db, tsFrom, tsTo);

    const metrics = analyze(samples, curve.points, {
      binWidth: cfg.binWidthV,
      minVoltage: 49.5,
      maxPower: cfg.maxPowerW,
      perPointJumpFactor: 1.25,
      analyzerVersion: cfg.analyzerVersion,
    });

    const parasitic = computeParasitic(samples);

    const free = suggestFreeCurve(metrics.envelope, metrics.stalls.hotspots, {
      targetPointCount: 16,
      maxPower: cfg.maxPowerW,
      hotspotBackoff: 0.85,
      confidenceThreshold: 0.3,
      firstVoltage: 49.5,
      maxVoltage: 140,
      parasiticCeilingV: parasitic.ceilingV,
      parasiticFloorW: 0,
      extrapolationFallback: REALISTIC_EXTRAPOLATION,
    });

    return Response.json({
      recommendation: free,
      pointCount: free.length,
      parasitic: {
        ceilingV: parasitic.ceilingV,
        totalDrainWh: parasitic.totalDrainWh,
      },
    });
  },
};
