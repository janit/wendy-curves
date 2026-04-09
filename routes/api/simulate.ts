import { getDb, getConfig } from "../../lib/state.ts";
import { getCurve } from "../../lib/curves.ts";
import { currentActivation } from "../../lib/activations.ts";
import { getSamplesInWindow } from "../../lib/db.ts";
import { analyze, computeVerdict } from "../../lib/analyzer.ts";
import type { CurvePoint } from "../../lib/types.ts";

/**
 * POST /api/simulate
 * Body: { points: CurvePoint[], tsFrom?: number, tsTo?: number, name?: string }
 *
 * Runs the analyzer against the provided curve points AND against the
 * currently active curve, both over the same sample window. Returns
 * both metric sets plus the verdict label. Lets the UI compare any
 * draft/suggestion against the active curve without activating it.
 *
 * If no points are provided, returns 400.
 * If no active curve, returns 409.
 */
export const handler = {
  async POST(ctx: { req: Request }) {
    const body = await ctx.req.json().catch(() => ({})) as {
      points?: CurvePoint[];
      tsFrom?: number;
      tsTo?: number;
      name?: string;
    };

    if (!Array.isArray(body.points) || body.points.length === 0) {
      return new Response(
        JSON.stringify({ error: "points array required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = getDb();
    const cfg = getConfig();
    const act = currentActivation(db);
    if (!act) {
      return new Response(
        JSON.stringify({ error: "no active curve" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    const activeCurve = getCurve(db, act.curveId);
    if (!activeCurve) {
      return new Response("active curve missing", { status: 500 });
    }

    const tsFrom = body.tsFrom ?? act.tsFrom;
    const tsTo = body.tsTo ?? Math.floor(Date.now() / 1000);
    const samples = getSamplesInWindow(db, tsFrom, tsTo);

    const opts = {
      binWidth: cfg.binWidthV,
      minVoltage: 49.5,
      maxPower: 5000,
      perPointJumpFactor: 1.25,
      analyzerVersion: cfg.analyzerVersion,
    };

    const simulated = analyze(samples, body.points, opts);
    const active = analyze(samples, activeCurve.points, opts);
    const verdict = computeVerdict(simulated, active, { minMpptHours: 6 });

    return Response.json({
      simulated,
      active,
      activeCurveName: activeCurve.name,
      simulatedName: body.name ?? "draft",
      verdict,
      window: { tsFrom, tsTo },
    });
  },
};
