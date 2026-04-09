import { Database } from "@db/sqlite";
import { latestSampleTs, insertSamples } from "./db.ts";
import type { WendySource } from "./wendy-source.ts";
import type { Sample, WendyHistoryRow, WendyMergedState } from "./types.ts";

/**
 * Map a wendy history row (source='tristar') into our samples schema.
 * Bootstrap rows lack charge_state because wendy doesn't store it.
 */
function historyRowToSample(r: WendyHistoryRow): Sample {
  return {
    ts: r.ts,
    arrayVoltage: r.voltage,
    arrayCurrent: r.current,
    tristarPower: r.power,
    batteryVoltage: null,
    chargeState: null,
    victron48vPower: null,
    victron24vPower: null,
    mode: r.mode,
  };
}

/**
 * Fetch wendy history for the gap between our latest sample and `nowTs`.
 * On first run, fetch the last `bootstrapHours` hours.
 * Returns the number of NEW rows inserted (excluding already-present timestamps).
 */
export async function bootstrapHistory(
  db: Database,
  src: WendySource,
  bootstrapHours: number,
  nowTs: number,
): Promise<number> {
  const latest = latestSampleTs(db);
  const from = latest > 0 ? latest + 1 : Math.max(0, nowTs - bootstrapHours * 3600);
  const rows = await src.fetchHistory(from, nowTs, "tristar");
  if (rows.length === 0) return 0;

  // Dedupe against existing rows in the min..max ts range of this batch.
  // Two parameters regardless of row count, so it never hits the SQLite
  // SQLITE_MAX_VARIABLE_NUMBER limit (32,766 by default).
  let minTs = rows[0].ts;
  let maxTs = rows[0].ts;
  for (let i = 1; i < rows.length; i++) {
    const t = rows[i].ts;
    if (t < minTs) minTs = t;
    if (t > maxTs) maxTs = t;
  }
  const existing = new Set(
    db.prepare("SELECT ts FROM samples WHERE ts >= ? AND ts <= ?")
      .all<{ ts: number }>(minTs, maxTs)
      .map((r) => r.ts),
  );

  const newRows = rows.filter((r) => !existing.has(r.ts)).map(historyRowToSample);
  insertSamples(db, newRows);
  return newRows.length;
}

/**
 * Fetch archived days from wendy (one HTTP call per day) and insert any
 * samples that we don't already have. Used once on first run to shrink
 * the cold-start blind spot from 7 days to up to 365.
 *
 * Silently returns 0 if the WendySource doesn't implement archive methods,
 * or if wendy's archive is disabled (503).
 */
export async function bootstrapArchive(
  db: Database,
  src: WendySource,
  archiveBootstrapDays: number,
  nowTs: number,
): Promise<number> {
  if (!src.fetchArchiveDays || !src.fetchArchiveDay) return 0;

  const fromDate = new Date((nowTs - archiveBootstrapDays * 86400) * 1000).toISOString().slice(0, 10);
  // Yesterday is the last COMPLETE archived day (today isn't done yet)
  const yesterdayDate = new Date((nowTs - 86400) * 1000).toISOString().slice(0, 10);

  let days;
  try {
    days = await src.fetchArchiveDays(fromDate, yesterdayDate);
  } catch (err) {
    console.error("[ingest] archive days list failed:", err);
    return 0;
  }
  if (days.length === 0) return 0;

  console.log(`[ingest] archive bootstrap: ${days.length} day(s) from ${fromDate} to ${yesterdayDate}`);

  let total = 0;
  for (const day of days) {
    try {
      const rows = await src.fetchArchiveDay(day.date, "tristar");
      if (rows.length === 0) continue;
      // Dedupe against existing rows in the min..max ts range of this batch.
      // Two parameters regardless of row count, so it never hits the SQLite
      // SQLITE_MAX_VARIABLE_NUMBER limit (32,766 by default).
      let minTs = rows[0].ts;
      let maxTs = rows[0].ts;
      for (let i = 1; i < rows.length; i++) {
        const t = rows[i].ts;
        if (t < minTs) minTs = t;
        if (t > maxTs) maxTs = t;
      }
      const existingTs = new Set(
        db.prepare("SELECT ts FROM samples WHERE ts >= ? AND ts <= ?")
          .all<{ ts: number }>(minTs, maxTs)
          .map((r) => r.ts),
      );
      const newRows = rows.filter((r) => !existingTs.has(r.ts)).map(historyRowToSample);
      insertSamples(db, newRows);
      total += newRows.length;
    } catch (err) {
      console.error(`[ingest] archive day ${day.date} failed:`, err);
      // Continue with next day
    }
  }
  console.log(`[ingest] archive bootstrap inserted ${total} new sample(s)`);
  return total;
}

function mergedStateToSample(s: WendyMergedState, ts: number): Sample {
  return {
    ts,
    arrayVoltage: s.arrayVoltage,
    arrayCurrent: s.current,
    tristarPower: s.tristarPower,
    batteryVoltage: s.batteryVoltage,
    chargeState: s.chargeState,
    victron48vPower: s.victron48vPower,
    victron24vPower: s.victronPower,
    victron24vVoltage: s.victronVoltage,
    victronChargedKwh: s.victronChargedKwh ?? null,        // NEW
    victron48vChargedKwh: s.victron48vChargedKwh ?? null,  // NEW
    mode: s.mode,
  };
}

interface IngesterOptions {
  bootstrapHours: number;
  archiveBootstrapDays?: number;  // NEW — 0 or undefined disables archive prefetch
  nowTs?: () => number;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * Start the ingester loop. Bootstraps history once, then opens an SSE
 * stream and writes events as they arrive. On disconnect, reconnects
 * with exponential backoff and re-runs bootstrapHistory to fill the gap.
 *
 * Returns a stop function.
 */
export async function startIngester(
  db: Database,
  src: WendySource,
  opts: IngesterOptions,
): Promise<() => void> {
  const now = opts.nowTs ?? (() => Math.floor(Date.now() / 1000));

  let stopped = false;
  let close: (() => void) | null = null;
  let reconnectTimer: number | null = null;
  let backoffMs = 1000;

  const open = async () => {
    if (stopped) return;

    // Archive bootstrap: only on truly first run (empty DB)
    try {
      if (latestSampleTs(db) === 0) {
        await bootstrapArchive(db, src, opts.archiveBootstrapDays ?? 0, now());
      }
    } catch (err) {
      console.error("[ingest] archive bootstrap failed:", err);
    }

    try {
      await bootstrapHistory(db, src, opts.bootstrapHours, now());
    } catch (err) {
      console.error("[ingest] bootstrap failed:", err);
    }
    close = src.openEventStream(
      (data) => {
        opts.onConnect?.();
        backoffMs = 1000;
        try {
          const s = data as Partial<WendyMergedState>;
          if (s && typeof s === "object") {
            insertSamples(db, [mergedStateToSample(s as WendyMergedState, now())]);
          }
        } catch (err) {
          console.error("[ingest] insert failed:", err);
        }
      },
      (err) => {
        console.error("[ingest] stream error:", err);
        opts.onDisconnect?.();
        if (close) close();
        close = null;
        if (stopped) return;
        reconnectTimer = setTimeout(open, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 60_000);
      },
    );
  };

  await open();

  return () => {
    stopped = true;
    if (reconnectTimer != null) clearTimeout(reconnectTimer);
    if (close) close();
  };
}
