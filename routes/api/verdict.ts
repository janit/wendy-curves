import { getDb, getConfig } from "../../lib/state.ts";
import { getCurve } from "../../lib/curves.ts";
import { listActivations } from "../../lib/activations.ts";
import { getSamplesInWindow } from "../../lib/db.ts";
import { analyze, computeVerdict } from "../../lib/analyzer.ts";

export const handler = {
  GET() {
    const db = getDb();
    const cfg = getConfig();
    const acts = listActivations(db);
    if (acts.length === 0) {
      return Response.json({ label: "INSUFFICIENT_DATA", detail: null, reason: "no activations" });
    }
    const active = acts[acts.length - 1];
    const previous = acts.length >= 2 ? acts[acts.length - 2] : null;

    const activeCurve = getCurve(db, active.curveId);
    if (!activeCurve) return new Response("active curve missing", { status: 500 });

    const opts = {
      binWidth: cfg.binWidthV,
      minVoltage: 49.5,
      maxPower: cfg.maxPowerW,
      perPointJumpFactor: 1.25,
      analyzerVersion: cfg.analyzerVersion,
    };

    const now = Math.floor(Date.now() / 1000);
    const activeSamples = getSamplesInWindow(db, active.tsFrom, active.tsTo ?? now);
    const activeMetrics = analyze(activeSamples, activeCurve.points, opts);

    if (!previous) {
      return Response.json({
        label: "INSUFFICIENT_DATA",
        detail: null,
        reason: "no previous curve to compare against",
        active: activeMetrics,
      });
    }

    const previousCurve = getCurve(db, previous.curveId);
    if (!previousCurve) return new Response("previous curve missing", { status: 500 });
    const previousSamples = getSamplesInWindow(db, previous.tsFrom, previous.tsTo ?? now);
    const previousMetrics = analyze(previousSamples, previousCurve.points, opts);

    const verdict = computeVerdict(activeMetrics, previousMetrics, { minMpptHours: 6 });
    return Response.json({
      label: verdict.label,
      detail: verdict.detail,
      activeCurveName: activeCurve.name,
      previousCurveName: previousCurve.name,
    });
  },
};
