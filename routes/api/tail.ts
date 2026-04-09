import { getDb } from "../../lib/state.ts";
import type { Sample } from "../../lib/types.ts";

const SAMPLE_COLS =
  "ts, array_voltage, array_current, tristar_power, battery_voltage, " +
  "charge_state, victron_48v_power, victron_24v_power, victron_24v_voltage, " +
  "victron_charged_kwh, victron_48v_charged_kwh, mode";

const DEFAULT_N = 50;
const MAX_N = 500;

function rowToSample(r: Record<string, unknown>): Sample {
  return {
    ts: r.ts as number,
    arrayVoltage: r.array_voltage as number | null,
    arrayCurrent: r.array_current as number | null,
    tristarPower: r.tristar_power as number | null,
    batteryVoltage: r.battery_voltage as number | null,
    chargeState: r.charge_state as string | null,
    victron48vPower: r.victron_48v_power as number | null,
    victron24vPower: r.victron_24v_power as number | null,
    victron24vVoltage: r.victron_24v_voltage as number | null,
    victronChargedKwh: r.victron_charged_kwh as number | null,
    victron48vChargedKwh: r.victron_48v_charged_kwh as number | null,
    mode: r.mode as string | null,
  };
}

/**
 * GET /api/tail?n=50
 *
 * Returns the last N samples ordered newest-first. Capped at MAX_N=500.
 * Intended for a live-tail UI — poll every 1-2 seconds.
 */
export const handler = {
  GET(ctx: { req: Request }) {
    const url = new URL(ctx.req.url);
    const nParam = url.searchParams.get("n");
    let n = DEFAULT_N;
    if (nParam != null) {
      const parsed = parseInt(nParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) n = Math.min(parsed, MAX_N);
    }
    const rows = getDb().prepare(
      `SELECT ${SAMPLE_COLS} FROM samples ORDER BY ts DESC LIMIT ?`,
    ).all<Record<string, unknown>>(n).map(rowToSample);
    return Response.json({ rows, n });
  },
};
