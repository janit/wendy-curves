import { getDb, getConfig } from "../../lib/state.ts";
import { getCurve } from "../../lib/curves.ts";
import { currentActivation } from "../../lib/activations.ts";
import { getSamplesInWindow } from "../../lib/db.ts";
import { analyze } from "../../lib/analyzer.ts";

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
    return Response.json({ recommendation: metrics.recommendation });
  },
};
