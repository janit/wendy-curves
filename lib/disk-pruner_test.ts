import { assertEquals } from "@std/assert";
import { openDb, insertSample } from "./db.ts";
import { pruneIfLowDisk } from "./disk-pruner.ts";

function insertRange(db: ReturnType<typeof openDb>, fromTs: number, toTs: number): void {
  for (let ts = fromTs; ts <= toTs; ts += 60) { // one sample per minute, sparse for speed
    insertSample(db, {
      ts, arrayVoltage: 60, arrayCurrent: null, tristarPower: 10,
      batteryVoltage: 52, chargeState: "mppt",
      victron48vPower: 5, victron24vPower: null, victron24vVoltage: null, mode: "48v",
    });
  }
}

Deno.test("pruneIfLowDisk is a no-op when disk has plenty of free space", async () => {
  const db = openDb(":memory:");
  insertRange(db, 1_000_000, 1_000_000 + 86400); // 1 day of samples
  const result = await pruneIfLowDisk(db, "/tmp", {
    minFreeGb: 0.001, // 1 MB — trivially met
    minRetentionDays: 1,
    batchHours: 1,
    checkIntervalMin: 60,
    vacuumAfter: false,
  });
  assertEquals(result.reason, "ok");
  assertEquals(result.samplesDeleted, 0);
  db.close();
});

Deno.test("pruneIfLowDisk respects the retention floor even when disk is low", async () => {
  const db = openDb(":memory:");
  // 3 days of samples
  insertRange(db, 1_000_000, 1_000_000 + 3 * 86400);
  // Unrealistically high threshold so the prune loop keeps going
  const result = await pruneIfLowDisk(db, "/tmp", {
    minFreeGb: 1e12, // 1 TB — definitely below threshold
    minRetentionDays: 1,
    batchHours: 1,
    checkIntervalMin: 60,
    vacuumAfter: false,
  }, 1_000_000 + 3 * 86400);
  // Samples older than (latest - 1 day) should be deleted; the rest preserved.
  // Latest = 1_000_000 + 3*86400; retention cutoff = latest - 86400 = 1_000_000 + 2*86400
  assertEquals(result.reachedRetentionFloor, true);
  const oldest = db.prepare("SELECT MIN(ts) as t FROM samples").get<{ t: number }>()!.t;
  // All remaining samples must be >= retention floor
  const expectedFloor = (1_000_000 + 3 * 86400) - 86400;
  assertEquals(oldest >= expectedFloor, true);
  db.close();
});

Deno.test("pruneIfLowDisk does nothing on an empty DB", async () => {
  const db = openDb(":memory:");
  const result = await pruneIfLowDisk(db, "/tmp", {
    minFreeGb: 1e12,
    minRetentionDays: 1,
    batchHours: 1,
    checkIntervalMin: 60,
    vacuumAfter: false,
  });
  assertEquals(result.reason, "no-data");
  assertEquals(result.samplesDeleted, 0);
  db.close();
});
