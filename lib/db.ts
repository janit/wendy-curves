import { Database } from "@db/sqlite";
import { MIGRATION_001_INITIAL } from "./migrations/001_initial.ts";
import { MIGRATION_002_ADD_VICTRON_24V_VOLTAGE } from "./migrations/002_add_victron_24v_voltage.ts";
import { MIGRATION_003_ADD_CHARGE_COUNTERS } from "./migrations/003_add_charge_counters.ts";

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: MIGRATION_001_INITIAL },
  { version: 2, sql: MIGRATION_002_ADD_VICTRON_24V_VOLTAGE },
  { version: 3, sql: MIGRATION_003_ADD_CHARGE_COUNTERS },
];

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout = 30000");  // wait up to 30s during VACUUM
  db.exec("PRAGMA foreign_keys=ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_ts INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_version").all<{ version: number }>().map((r) => r.version),
  );

  const insertVersion = db.prepare("INSERT INTO schema_version (version, applied_ts) VALUES (?, ?)");

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      insertVersion.run(m.version, Math.floor(Date.now() / 1000));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  return db;
}

import type { Sample } from "./types.ts";

function num(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

const SAMPLE_COLS =
  "ts, array_voltage, array_current, tristar_power, battery_voltage, " +
  "charge_state, victron_48v_power, victron_24v_power, victron_24v_voltage, " +
  "victron_charged_kwh, victron_48v_charged_kwh, mode";

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

export function insertSample(db: Database, s: Sample): void {
  db.prepare(
    `INSERT OR REPLACE INTO samples (${SAMPLE_COLS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.ts,
    num(s.arrayVoltage),
    num(s.arrayCurrent),
    num(s.tristarPower),
    num(s.batteryVoltage),
    s.chargeState,
    num(s.victron48vPower),
    num(s.victron24vPower),
    num(s.victron24vVoltage),
    num(s.victronChargedKwh),
    num(s.victron48vChargedKwh),
    s.mode,
  );
}

export function insertSamples(db: Database, samples: Sample[]): void {
  if (samples.length === 0) return;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO samples (${SAMPLE_COLS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const s of samples) {
      stmt.run(
        s.ts,
        num(s.arrayVoltage),
        num(s.arrayCurrent),
        num(s.tristarPower),
        num(s.batteryVoltage),
        s.chargeState,
        num(s.victron48vPower),
        num(s.victron24vPower),
        num(s.victron24vVoltage),
        num(s.victronChargedKwh),
        num(s.victron48vChargedKwh),
        s.mode,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    stmt.finalize();
  }
}

export function getSamplesInWindow(db: Database, from: number, to: number): Sample[] {
  return db.prepare(
    `SELECT ${SAMPLE_COLS} FROM samples WHERE ts >= ? AND ts <= ? ORDER BY ts`,
  ).all<Record<string, unknown>>(from, to).map(rowToSample);
}

export function latestSampleTs(db: Database): number {
  const r = db.prepare("SELECT MAX(ts) as ts FROM samples").get<{ ts: number | null }>();
  return r?.ts ?? 0;
}
