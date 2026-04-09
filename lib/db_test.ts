import { assertEquals, assertExists } from "@std/assert";
import { openDb } from "./db.ts";
import { insertSample, insertSamples, getSamplesInWindow, latestSampleTs } from "./db.ts";

Deno.test("openDb creates schema on empty file", () => {
  const dbPath = ":memory:";
  const db = openDb(dbPath);

  // Tables exist
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all<{ name: string }>().map((r) => r.name);

  assertEquals(tables.includes("samples"), true);
  assertEquals(tables.includes("curves"), true);
  assertEquals(tables.includes("curve_points"), true);
  assertEquals(tables.includes("curve_activations"), true);
  assertEquals(tables.includes("metrics_cache"), true);
  assertEquals(tables.includes("notes"), true);
  assertEquals(tables.includes("schema_version"), true);

  // Migration recorded
  const v = db.prepare("SELECT MAX(version) as v FROM schema_version").get<{ v: number }>();
  assertExists(v);
  assertEquals(v.v, 3);

  db.close();
});

Deno.test("openDb is idempotent on re-open", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".db" });
  try {
    const db1 = openDb(tmp);
    db1.close();
    const db2 = openDb(tmp);  // re-open same file
    db2.close();
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test("insertSample + getSamplesInWindow round trip", () => {
  const db = openDb(":memory:");
  insertSample(db, {
    ts: 1000,
    arrayVoltage: 95.2, arrayCurrent: 4.1, tristarPower: 390,
    batteryVoltage: 51.8, chargeState: "mppt",
    victron48vPower: 380, victron24vPower: null,
    victron24vVoltage: 26.3,
    mode: "48v",
  });
  const rows = getSamplesInWindow(db, 0, 2000);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].ts, 1000);
  assertEquals(rows[0].arrayVoltage, 95.2);
  assertEquals(rows[0].victron24vVoltage, 26.3);
  db.close();
});

Deno.test("insertSamples is atomic and dedupes by ts", () => {
  const db = openDb(":memory:");
  insertSamples(db, [
    { ts: 1, arrayVoltage: 90, arrayCurrent: null, tristarPower: 100, batteryVoltage: null, chargeState: "mppt", victron48vPower: null, victron24vPower: null, mode: null },
    { ts: 2, arrayVoltage: 91, arrayCurrent: null, tristarPower: 110, batteryVoltage: null, chargeState: "mppt", victron48vPower: null, victron24vPower: null, mode: null },
    { ts: 1, arrayVoltage: 92, arrayCurrent: null, tristarPower: 120, batteryVoltage: null, chargeState: "mppt", victron48vPower: null, victron24vPower: null, mode: null },
  ]);
  const rows = getSamplesInWindow(db, 0, 100);
  assertEquals(rows.length, 2);
  // The later insert at ts=1 wins (INSERT OR REPLACE)
  assertEquals(rows.find((r) => r.ts === 1)?.arrayVoltage, 92);
  db.close();
});

Deno.test("latestSampleTs returns 0 on empty db, max ts otherwise", () => {
  const db = openDb(":memory:");
  assertEquals(latestSampleTs(db), 0);
  insertSample(db, {
    ts: 555, arrayVoltage: null, arrayCurrent: null, tristarPower: null,
    batteryVoltage: null, chargeState: null, victron48vPower: null,
    victron24vPower: null, mode: null,
  });
  assertEquals(latestSampleTs(db), 555);
  db.close();
});
