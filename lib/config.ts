export interface Config {
  port: number;
  dbPath: string;
  wendyUrl: string;
  wendySecret: string | null;
  bootstrapHours: number;
  archiveBootstrapDays: number;
  analyzerVersion: number;
  binWidthV: number;
  allowWrite: boolean;
  pruneEnabled: boolean;
  pruneMinFreeGb: number;
  pruneMinRetentionDays: number;
  pruneBatchHours: number;
  pruneCheckIntervalMin: number;
  maxPowerW: number;
}

function intEnv(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name}: not an integer (${v})`);
  return n;
}

function floatEnv(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  if (v == null) return fallback;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`${name}: not a number (${v})`);
  return n;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = Deno.env.get(name);
  if (v == null) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): Config {
  return {
    port: intEnv("WENDY_CURVES_PORT", 8087),
    dbPath: Deno.env.get("WENDY_CURVES_DB_PATH") ?? "./data/wendy-curves.db",
    wendyUrl: Deno.env.get("WENDY_CURVES_WENDY_URL") ?? "http://localhost:8086",
    wendySecret: Deno.env.get("WENDY_CURVES_WENDY_SECRET") ?? null,
    bootstrapHours: intEnv("WENDY_CURVES_BOOTSTRAP_HOURS", 24),
    archiveBootstrapDays: intEnv("WENDY_CURVES_ARCHIVE_BOOTSTRAP_DAYS", 365),
    analyzerVersion: intEnv("WENDY_CURVES_ANALYZER_VERSION", 1),
    binWidthV: floatEnv("WENDY_CURVES_BIN_WIDTH_V", 0.5),
    allowWrite: boolEnv("WENDY_CURVES_ALLOW_WRITE", false),
    pruneEnabled: boolEnv("WENDY_CURVES_PRUNE_ENABLED", true),
    pruneMinFreeGb: floatEnv("WENDY_CURVES_PRUNE_MIN_FREE_GB", 10),
    pruneMinRetentionDays: intEnv("WENDY_CURVES_PRUNE_MIN_RETENTION_DAYS", 7),
    pruneBatchHours: intEnv("WENDY_CURVES_PRUNE_BATCH_HOURS", 6),
    pruneCheckIntervalMin: intEnv("WENDY_CURVES_PRUNE_CHECK_INTERVAL_MIN", 60),
    maxPowerW: intEnv("WENDY_CURVES_MAX_POWER_W", 3000),
  };
}
