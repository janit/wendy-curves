import { getDb, getConfig } from "../../lib/state.ts";
import { getCurve } from "../../lib/curves.ts";
import { getSamplesInWindow } from "../../lib/db.ts";
import { analyze } from "../../lib/analyzer.ts";

export const handler = {
  async POST(ctx: { req: Request }) {
    const body = await ctx.req.json() as { curveId?: number; tsFrom?: number; tsTo?: number };
    if (typeof body.curveId !== "number" || typeof body.tsFrom !== "number" || typeof body.tsTo !== "number") {
      return new Response(JSON.stringify({ error: "curveId, tsFrom, tsTo required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const db = getDb();
    const cfg = getConfig();
    const curve = getCurve(db, body.curveId);
    if (!curve) return new Response("not found", { status: 404 });
    const samples = getSamplesInWindow(db, body.tsFrom, body.tsTo);
    const metrics = analyze(samples, curve.points, {
      binWidth: cfg.binWidthV,
      minVoltage: 49.5,
      maxPower: cfg.maxPowerW,
      perPointJumpFactor: 1.25,
      analyzerVersion: cfg.analyzerVersion,
    });
    return Response.json(metrics);
  },
};
