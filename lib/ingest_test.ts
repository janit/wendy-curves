import { assertEquals } from "@std/assert";
import { openDb } from "./db.ts";
import { latestSampleTs, getSamplesInWindow } from "./db.ts";
import { bootstrapHistory, bootstrapArchive } from "./ingest.ts";
import type { WendyHistoryRow } from "./types.ts";
import type { WendySource } from "./wendy-source.ts";
import type { ArchiveDayMeta } from "./wendy-source.ts";

class StubSource implements WendySource {
  constructor(public rows: WendyHistoryRow[]) {}
  fetchHistory(_from: number, _to: number, _source: string | null): Promise<WendyHistoryRow[]> {
    return Promise.resolve(this.rows);
  }
  openEventStream(): () => void { return () => {}; }
}

Deno.test("bootstrapHistory inserts rows mapped to samples schema", async () => {
  const db = openDb(":memory:");
  const src = new StubSource([
    { ts: 1000, source: "tristar", power: 250, voltage: 99, current: 2.5, temp: 30, mode: "48v" },
    { ts: 1001, source: "tristar", power: 260, voltage: 100, current: 2.6, temp: 30, mode: "48v" },
  ]);
  const inserted = await bootstrapHistory(db, src, 24, 9999);
  assertEquals(inserted, 2);
  const rows = getSamplesInWindow(db, 0, 9999);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].arrayVoltage, 99);
  assertEquals(rows[0].tristarPower, 250);
  // bootstrap rows have NULL charge_state (wendy's history doesn't carry it)
  assertEquals(rows[0].chargeState, null);
  db.close();
});

Deno.test("bootstrapHistory dedupes against existing samples", async () => {
  const db = openDb(":memory:");
  // Pre-existing row at ts=1000
  const { insertSample } = await import("./db.ts");
  insertSample(db, {
    ts: 1000, arrayVoltage: 90, arrayCurrent: 2, tristarPower: 180,
    batteryVoltage: 51, chargeState: "mppt", victron48vPower: 175,
    victron24vPower: null, mode: "48v",
  });
  const src = new StubSource([
    { ts: 1000, source: "tristar", power: 999, voltage: 999, current: 99, temp: 30, mode: "48v" },
    { ts: 1001, source: "tristar", power: 260, voltage: 100, current: 2.6, temp: 30, mode: "48v" },
  ]);
  const inserted = await bootstrapHistory(db, src, 24, 9999);
  // Existing row preserved, new row added
  assertEquals(inserted, 1);
  const existing = getSamplesInWindow(db, 1000, 1000)[0];
  assertEquals(existing.arrayVoltage, 90);  // preserved, not overwritten
  assertEquals(existing.chargeState, "mppt"); // preserved
  assertEquals(latestSampleTs(db), 1001);
  db.close();
});

Deno.test("bootstrapHistory uses latestSampleTs+1 as from when DB has data", async () => {
  const db = openDb(":memory:");
  const { insertSample } = await import("./db.ts");
  insertSample(db, {
    ts: 5000, arrayVoltage: null, arrayCurrent: null, tristarPower: null,
    batteryVoltage: null, chargeState: null, victron48vPower: null,
    victron24vPower: null, mode: null,
  });
  let receivedFrom = -1;
  const src: WendySource = {
    fetchHistory: (from, _to, _source) => {
      receivedFrom = from;
      return Promise.resolve([]);
    },
    openEventStream: () => () => {},
  };
  await bootstrapHistory(db, src, 24, 99999);
  assertEquals(receivedFrom, 5001);
  db.close();
});

import { startIngester } from "./ingest.ts";
import type { WendyMergedState } from "./types.ts";

class CapturedSource implements WendySource {
  fetchHistory(_from: number, _to: number, _source: string | null): Promise<WendyHistoryRow[]> {
    return Promise.resolve([]);
  }
  private cb: ((data: unknown) => void) | null = null;
  openEventStream(onEvent: (data: unknown) => void, _onError: (err: Error) => void): () => void {
    this.cb = onEvent;
    return () => { this.cb = null; };
  }
  emit(state: WendyMergedState): void {
    if (this.cb) this.cb(state);
  }
}

Deno.test("startIngester writes SSE events into samples", async () => {
  const db = openDb(":memory:");
  const src = new CapturedSource();
  const stop = await startIngester(db, src, { bootstrapHours: 24, nowTs: () => 12345 });
  src.emit({
    arrayVoltage: 110, current: 5.4, tristarPower: 590,
    batteryVoltage: 53.2, chargeState: "mppt",
    victron48vPower: 580, victronPower: 0, victronVoltage: null, mode: "48v",
  });
  // Allow event loop tick
  await new Promise((r) => setTimeout(r, 10));
  const rows = getSamplesInWindow(db, 0, 99999);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].arrayVoltage, 110);
  assertEquals(rows[0].chargeState, "mppt");
  assertEquals(rows[0].tristarPower, 590);
  assertEquals(rows[0].victron48vPower, 580);
  stop();
  db.close();
});

Deno.test("bootstrapArchive inserts rows from archive day fetches", async () => {
  const db = openDb(":memory:");
  class ArchiveStubSource implements WendySource {
    fetchHistory(): Promise<WendyHistoryRow[]> { return Promise.resolve([]); }
    openEventStream(): () => void { return () => {}; }
    fetchArchiveDays(_from: string, _to: string): Promise<ArchiveDayMeta[]> {
      return Promise.resolve([
        { date: "2026-04-01", row_count: 2, ts_start: 1, ts_end: 2, format: "gzip-cols-v1", created_at: 1 },
      ]);
    }
    fetchArchiveDay(_date: string, _source: string | null): Promise<WendyHistoryRow[]> {
      return Promise.resolve([
        { ts: 100, source: "tristar", power: 200, voltage: 90, current: 2.2, temp: 30, mode: "48v" },
        { ts: 101, source: "tristar", power: 210, voltage: 91, current: 2.3, temp: 30, mode: "48v" },
      ] as WendyHistoryRow[]);
    }
  }
  const src = new ArchiveStubSource();
  const inserted = await bootstrapArchive(db, src, 365, 99999);
  assertEquals(inserted, 2);
  const rows = getSamplesInWindow(db, 0, 99999);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].arrayVoltage, 90);
  db.close();
});

Deno.test("bootstrapArchive is a no-op when WendySource lacks archive methods", async () => {
  const db = openDb(":memory:");
  class OldStubSource implements WendySource {
    fetchHistory(): Promise<WendyHistoryRow[]> { return Promise.resolve([]); }
    openEventStream(): () => void { return () => {}; }
  }
  const src = new OldStubSource();
  const inserted = await bootstrapArchive(db, src, 365, 99999);
  assertEquals(inserted, 0);
  db.close();
});

Deno.test("bootstrapHistory handles >32k rows without SQLite variable limit error", async () => {
  const db = openDb(":memory:");
  // Generate 40,000 fake tristar rows — safely above SQLite's default 32,766 variable limit
  const rows: WendyHistoryRow[] = [];
  for (let i = 0; i < 40_000; i++) {
    rows.push({
      ts: 1_000_000 + i,
      source: "tristar",
      power: 100,
      voltage: 90,
      current: 1,
      temp: 25,
      mode: "48v",
    });
  }
  class BigSource implements WendySource {
    fetchHistory(_from: number, _to: number, _source: string | null): Promise<WendyHistoryRow[]> {
      return Promise.resolve(rows);
    }
    openEventStream(): () => void { return () => {}; }
  }
  const inserted = await bootstrapHistory(db, new BigSource(), 24, 2_000_000);
  assertEquals(inserted, 40_000);
  const stored = db.prepare("SELECT COUNT(*) as n FROM samples").get<{ n: number }>();
  assertEquals(stored?.n, 40_000);
  db.close();
});
