// Embedded SQL for migration 1. Kept in sync with 001_initial.sql by hand.
// The .ts version is what `lib/db.ts` imports because it survives bundling.

export const MIGRATION_001_INITIAL = `
CREATE TABLE IF NOT EXISTS samples (
  ts INTEGER PRIMARY KEY,
  array_voltage REAL,
  array_current REAL,
  tristar_power REAL,
  battery_voltage REAL,
  charge_state TEXT,
  victron_48v_power REAL,
  victron_24v_power REAL,
  mode TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_state ON samples(charge_state, ts);

CREATE TABLE IF NOT EXISTS curves (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_ts INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS curve_points (
  curve_id INTEGER NOT NULL,
  voltage REAL NOT NULL,
  power REAL NOT NULL,
  PRIMARY KEY (curve_id, voltage),
  FOREIGN KEY (curve_id) REFERENCES curves(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS curve_activations (
  id INTEGER PRIMARY KEY,
  curve_id INTEGER NOT NULL,
  ts_from INTEGER NOT NULL,
  ts_to INTEGER,
  note TEXT,
  FOREIGN KEY (curve_id) REFERENCES curves(id)
);
CREATE INDEX IF NOT EXISTS idx_activations_window ON curve_activations(ts_from, ts_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_open
  ON curve_activations(curve_id) WHERE ts_to IS NULL;

CREATE TABLE IF NOT EXISTS metrics_cache (
  curve_id INTEGER NOT NULL,
  ts_from INTEGER NOT NULL,
  ts_to INTEGER NOT NULL,
  analyzer_version INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  computed_ts INTEGER NOT NULL,
  PRIMARY KEY (curve_id, ts_from, ts_to, analyzer_version)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  curve_id INTEGER,
  body TEXT NOT NULL
);
`;
