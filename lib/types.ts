/** A single (V, W) setpoint of a power curve. */
export interface CurvePoint {
  voltage: number;
  power: number;
}

/** A named, immutable curve. */
export interface Curve {
  id: number;
  name: string;
  notes: string | null;
  createdTs: number;
  source: "manual" | "suggested" | "imported";
  points: CurvePoint[];
}

/** A window during which a curve was loaded. */
export interface Activation {
  id: number;
  curveId: number;
  tsFrom: number;
  tsTo: number | null;
  note: string | null;
}

/** One row of the wendy-curves samples table. */
export interface Sample {
  ts: number;
  arrayVoltage: number | null;
  arrayCurrent: number | null;
  tristarPower: number | null;
  batteryVoltage: number | null;
  chargeState: string | null;
  victron48vPower: number | null;
  victron24vPower: number | null;
  victron24vVoltage?: number | null;  // 24V battery voltage from BMV-700
  victronChargedKwh?: number | null;    // 24V cumulative at this ts
  victron48vChargedKwh?: number | null; // 48V cumulative at this ts
  mode: string | null;
}

/** Wendy's MergedState shape, narrowed to the fields we consume. */
export interface WendyMergedState {
  arrayVoltage: number | null;
  current: number | null;
  tristarPower: number | null;
  batteryVoltage: number | null;
  chargeState: string | null;
  victron48vPower: number | null;
  victronPower: number | null;      // 24V shunt power
  victronVoltage: number | null;    // 24V battery voltage
  mode: "24v" | "48v";
  victronChargedKwh?: number;    // cumulative 24V BMV charge counter (kWh, monotonic)
  victron48vChargedKwh?: number; // cumulative 48V shunt charge counter (kWh, monotonic)
  todayKwh?: number;             // kWh charged today (24V + 48V combined), from wendy's own accounting
  todayKwh24v?: number;          // kWh charged today via Marsrock/BMV-700
  todayKwh48v?: number;          // kWh charged today via TriStar/48V shunt
}

/** Wendy's /api/history row shape. */
export interface WendyHistoryRow {
  ts: number;
  source: string;
  power: number | null;
  voltage: number | null;
  current: number | null;
  temp: number | null;
  mode: string | null;
}
