import { Database } from "@db/sqlite";
import { latestSampleTs } from "./db.ts";

export interface DiskPrunerOptions {
  minFreeGb: number;           // default 10
  minRetentionDays: number;    // default 7 — never prune below this many days of data
  batchHours: number;          // default 6 — delete this many hours of oldest samples per iteration
  checkIntervalMin: number;    // default 60
  vacuumAfter: boolean;        // default true
}

export interface PruneResult {
  freeBytesBefore: number;
  freeBytesAfter: number;
  samplesDeleted: number;
  oldestTsBefore: number | null;
  oldestTsAfter: number | null;
  vacuumed: boolean;
  reachedRetentionFloor: boolean;
  reason: "ok" | "disabled" | "no-data" | "all-above-floor" | "pruned";
}

/**
 * Get free bytes on the filesystem containing `path` by running `df`.
 * Returns Infinity if df fails (don't prune on errors — safer than accidentally deleting).
 */
export async function getFreeDiskBytes(path: string): Promise<number> {
  try {
    const cmd = new Deno.Command("df", {
      args: ["--output=avail", "-B1", path],
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return Infinity;
    const text = new TextDecoder().decode(stdout).trim();
    // Output shape:
    //     Avail
    // 123456789
    const lines = text.split("\n");
    if (lines.length < 2) return Infinity;
    const n = parseInt(lines[1].trim(), 10);
    return Number.isFinite(n) ? n : Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * Run a single prune pass. Deletes oldest samples in batches of
 * `batchHours` until free disk is above the threshold OR the minimum
 * retention floor is reached. Runs VACUUM after any deletion.
 */
export async function pruneIfLowDisk(
  db: Database,
  dbPath: string,
  opts: DiskPrunerOptions,
  now: number = Math.floor(Date.now() / 1000),
): Promise<PruneResult> {
  const thresholdBytes = opts.minFreeGb * 1024 * 1024 * 1024;
  const freeBefore = await getFreeDiskBytes(dbPath);
  const oldestRow = db.prepare("SELECT MIN(ts) as t FROM samples").get<{ t: number | null }>();
  const oldestTsBefore = oldestRow?.t ?? null;

  if (freeBefore >= thresholdBytes) {
    return {
      freeBytesBefore: freeBefore,
      freeBytesAfter: freeBefore,
      samplesDeleted: 0,
      oldestTsBefore,
      oldestTsAfter: oldestTsBefore,
      vacuumed: false,
      reachedRetentionFloor: false,
      reason: "ok",
    };
  }

  if (oldestTsBefore == null) {
    return {
      freeBytesBefore: freeBefore,
      freeBytesAfter: freeBefore,
      samplesDeleted: 0,
      oldestTsBefore: null,
      oldestTsAfter: null,
      vacuumed: false,
      reachedRetentionFloor: false,
      reason: "no-data",
    };
  }

  // Retention floor: don't delete anything younger than (latest - minRetentionDays)
  const latestTs = latestSampleTs(db);
  const retentionFloorTs = latestTs - opts.minRetentionDays * 86400;

  console.log(
    `[pruner] free=${(freeBefore / 1e9).toFixed(2)}GB below threshold=${opts.minFreeGb}GB, ` +
    `retention floor=${new Date(retentionFloorTs * 1000).toISOString()}`,
  );

  let totalDeleted = 0;
  let reachedFloor = false;
  let iterationCount = 0;
  const maxIterations = 50; // safety: never loop forever

  while (iterationCount++ < maxIterations) {
    const currentOldest = db.prepare("SELECT MIN(ts) as t FROM samples").get<{ t: number | null }>()?.t;
    if (currentOldest == null) break;

    // Next batch: delete everything older than (currentOldest + batchHours)
    const batchCutoff = currentOldest + opts.batchHours * 3600;

    // Clamp to retention floor
    if (batchCutoff > retentionFloorTs) {
      reachedFloor = true;
      // Delete up to retention floor only
      if (currentOldest >= retentionFloorTs) break; // nothing to delete
      const res = db.prepare("DELETE FROM samples WHERE ts < ?").run(retentionFloorTs);
      totalDeleted += Number(res);
      break;
    }

    const res = db.prepare("DELETE FROM samples WHERE ts < ?").run(batchCutoff);
    const deleted = Number(res);
    totalDeleted += deleted;
    if (deleted === 0) break;

    // Re-check disk every 3 batches so we don't over-delete
    if (iterationCount % 3 === 0) {
      const free = await getFreeDiskBytes(dbPath);
      if (free >= thresholdBytes) break;
    }
  }

  // Always vacuum if we deleted anything — freed pages need to be returned to the OS
  let vacuumed = false;
  if (totalDeleted > 0 && opts.vacuumAfter) {
    try {
      console.log(`[pruner] deleted ${totalDeleted} samples, running VACUUM to reclaim disk`);
      db.exec("VACUUM");
      vacuumed = true;
    } catch (err) {
      console.error("[pruner] VACUUM failed:", err);
    }
  }

  const freeAfter = await getFreeDiskBytes(dbPath);
  const oldestAfterRow = db.prepare("SELECT MIN(ts) as t FROM samples").get<{ t: number | null }>();
  const oldestTsAfter = oldestAfterRow?.t ?? null;

  if (totalDeleted === 0 && reachedFloor) {
    console.warn(
      `[pruner] disk still low (${(freeAfter / 1e9).toFixed(2)}GB free) but retention floor reached — cannot prune further`,
    );
  } else if (totalDeleted > 0) {
    console.log(
      `[pruner] done: deleted ${totalDeleted}, free ${(freeBefore / 1e9).toFixed(2)}GB → ${(freeAfter / 1e9).toFixed(2)}GB, ` +
      `vacuumed=${vacuumed}`,
    );
  }

  return {
    freeBytesBefore: freeBefore,
    freeBytesAfter: freeAfter,
    samplesDeleted: totalDeleted,
    oldestTsBefore,
    oldestTsAfter,
    vacuumed,
    reachedRetentionFloor: reachedFloor,
    reason: totalDeleted > 0 ? "pruned" : "all-above-floor",
  };
}

/**
 * Start a periodic pruner timer. Runs once immediately (to catch
 * an already-full disk at boot), then every `checkIntervalMin` minutes.
 * Returns a stop function.
 */
export function startDiskPruner(
  db: Database,
  dbPath: string,
  opts: DiskPrunerOptions,
): () => void {
  let stopped = false;
  let timer: number | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await pruneIfLowDisk(db, dbPath, opts);
    } catch (err) {
      console.error("[pruner] pass failed:", err);
    }
    if (!stopped) {
      timer = setTimeout(tick, opts.checkIntervalMin * 60 * 1000);
    }
  };

  // First pass runs immediately; subsequent passes scheduled via setTimeout
  tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
