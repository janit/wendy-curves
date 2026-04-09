import { getDb, getLastEvent, isWendyConnected } from "../../lib/state.ts";
import { currentActivation } from "../../lib/activations.ts";
import { getCurve } from "../../lib/curves.ts";
import { latestSampleTs } from "../../lib/db.ts";

export const handler = {
  GET() {
    const db = getDb();
    const act = currentActivation(db);
    const activeCurve = act ? getCurve(db, act.curveId) : null;

    const sampleCount = db.prepare("SELECT COUNT(*) as n FROM samples").get<{ n: number }>()?.n ?? 0;
    const oldestTs = db.prepare("SELECT MIN(ts) as t FROM samples").get<{ t: number | null }>()?.t ?? null;
    const newestTs = latestSampleTs(db);

    return new Response(
      JSON.stringify({
        activation: act,
        activeCurve,
        wendyConnected: isWendyConnected(),
        lastEvent: getLastEvent(),
        db: { sampleCount, oldestTs, newestTs },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
