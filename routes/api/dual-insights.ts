import { getDb } from "../../lib/state.ts";
import { currentActivation } from "../../lib/activations.ts";
import { getSamplesInWindow } from "../../lib/db.ts";
import { computeDualInsights } from "../../lib/dual-insights.ts";

/**
 * POST /api/dual-insights
 * Body: { tsFrom?: number, tsTo?: number }
 *
 * Returns dual-mode MPPT insights (24V Marsrock harvest, 48V TriStar
 * harvest, relay coil drain, mode distribution) for the given window.
 * Defaults to the current activation window if not specified.
 */
export const handler = {
  async POST(ctx: { req: Request }) {
    const body = await ctx.req.json().catch(() => ({})) as { tsFrom?: number; tsTo?: number };
    const db = getDb();
    const act = currentActivation(db);
    const now = Math.floor(Date.now() / 1000);
    const tsFrom = body.tsFrom ?? act?.tsFrom ?? (now - 7 * 86400);
    const tsTo = body.tsTo ?? now;
    const samples = getSamplesInWindow(db, tsFrom, tsTo);
    const insights = computeDualInsights(samples);
    return Response.json({
      ...insights,
      window: { tsFrom, tsTo, totalSamples: samples.length },
    });
  },
};
