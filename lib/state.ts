import type { Database } from "@db/sqlite";
import type { Config } from "./config.ts";

const g = globalThis as unknown as {
  __wc_db?: Database;
  __wc_config?: Config;
  __wc_lastEvent?: { ts: number; state: unknown };
  __wc_wendyConnected?: boolean;
};

export function initState(db: Database, config: Config): void {
  g.__wc_db = db;
  g.__wc_config = config;
  g.__wc_wendyConnected = false;
}

export function getDb(): Database {
  if (!g.__wc_db) throw new Error("DB not initialised");
  return g.__wc_db;
}

export function getConfig(): Config {
  if (!g.__wc_config) throw new Error("Config not initialised");
  return g.__wc_config;
}

export function setLastEvent(state: unknown): void {
  g.__wc_lastEvent = { ts: Math.floor(Date.now() / 1000), state };
}

export function getLastEvent(): { ts: number; state: unknown } | null {
  return g.__wc_lastEvent ?? null;
}

export function setWendyConnected(connected: boolean): void {
  g.__wc_wendyConnected = connected;
}

export function isWendyConnected(): boolean {
  return g.__wc_wendyConnected ?? false;
}
