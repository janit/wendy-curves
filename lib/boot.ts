import { loadConfig } from "./config.ts";
import { openDb, latestSampleTs } from "./db.ts";
import { initState, setLastEvent, setWendyConnected } from "./state.ts";
import { HttpWendySource } from "./wendy-source.ts";
import { startIngester } from "./ingest.ts";
import { seedIfEmpty } from "./seed.ts";
import { startDiskPruner } from "./disk-pruner.ts";

export async function boot(): Promise<number> {
  const config = loadConfig();
  console.log(`[boot] port=${config.port} db=${config.dbPath} wendy=${config.wendyUrl}`);

  // Ensure data directory exists for ./data/wendy-curves.db default
  try {
    const dir = config.dbPath.replace(/\/[^/]+$/, "");
    if (dir && dir !== config.dbPath) {
      await Deno.mkdir(dir, { recursive: true });
    }
  } catch { /* fine if already exists */ }

  const db = openDb(config.dbPath);
  initState(db, config);

  // Seed at the earliest known sample ts (or now if DB empty)
  const earliest = latestSampleTs(db) > 0 ? latestSampleTs(db) : Math.floor(Date.now() / 1000);
  seedIfEmpty(db, earliest);

  const src = new HttpWendySource(config.wendyUrl, config.wendySecret);

  // Start ingester. Wrap to track connection state for the footer.
  await startIngester(db, {
    fetchHistory: src.fetchHistory.bind(src),
    fetchArchiveDays: src.fetchArchiveDays.bind(src),
    fetchArchiveDay: src.fetchArchiveDay.bind(src),
    openEventStream(onEvent, onError) {
      return src.openEventStream(
        (data) => {
          setWendyConnected(true);
          setLastEvent(data);
          onEvent(data);
        },
        (err) => {
          setWendyConnected(false);
          onError(err);
        },
      );
    },
  }, {
    bootstrapHours: config.bootstrapHours,
    archiveBootstrapDays: config.archiveBootstrapDays,
  });

  if (config.pruneEnabled) {
    console.log(
      `[boot] starting disk pruner: minFreeGb=${config.pruneMinFreeGb}, ` +
      `minRetentionDays=${config.pruneMinRetentionDays}, batchHours=${config.pruneBatchHours}, ` +
      `intervalMin=${config.pruneCheckIntervalMin}`,
    );
    startDiskPruner(db, config.dbPath, {
      minFreeGb: config.pruneMinFreeGb,
      minRetentionDays: config.pruneMinRetentionDays,
      batchHours: config.pruneBatchHours,
      checkIntervalMin: config.pruneCheckIntervalMin,
      vacuumAfter: true,
    });
  } else {
    console.log("[boot] disk pruner disabled via WENDY_CURVES_PRUNE_ENABLED=0");
  }

  return config.port;
}
