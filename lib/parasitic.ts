import type { Sample } from "./types.ts";

export interface ParasiticBin {
  voltage: number;      // lower edge of 1V bin
  sampleCount: number;
  parasiticCount: number;
  parasiticPct: number; // 0-100
  meanShuntW: number;
  drainWh: number;      // integral of -victron_48v_power over parasitic samples, assuming 1Hz
}

export interface ParasiticResult {
  ceilingV: number | null;     // highest bin voltage with parasiticPct >= threshold, or null
  totalDrainWh: number;
  byBin: ParasiticBin[];
}

export interface ParasiticOptions {
  binWidthV: number;              // default 1.0
  parasiticThresholdPct: number;  // default 5 — a bin is "parasitic" if pct >= threshold
  minSamplesPerBin: number;       // default 3 — bins below this are ignored for ceiling detection
}

/**
 * Identify the parasitic voltage zone from sample data. A sample is
 * parasitic when the TriStar is in MPPT charge state and the 48V shunt
 * reports negative power (i.e. current is flowing OUT of the battery,
 * not into it). This happens when the TriStar's power stage is engaged
 * but the wind-side input is insufficient to cover the converter's
 * self-consumption.
 *
 * Returns the highest 1V bin (inclusive lower edge) whose parasitic
 * fraction meets the threshold, plus a per-bin breakdown and total drain.
 */
export function computeParasitic(samples: Sample[], opts: Partial<ParasiticOptions> = {}): ParasiticResult {
  const binWidth = opts.binWidthV ?? 1.0;
  const threshold = opts.parasiticThresholdPct ?? 5;
  const minSamples = opts.minSamplesPerBin ?? 3;

  // Group by 1V bin, only MPPT state with a shunt reading
  const bins = new Map<number, { samples: Sample[]; parasitic: Sample[] }>();
  for (const s of samples) {
    if (s.chargeState !== "mppt") continue;
    if (s.arrayVoltage == null) continue;
    if (s.victron48vPower == null) continue;
    const edge = Math.floor(s.arrayVoltage / binWidth) * binWidth;
    const key = Math.round(edge * 10) / 10;
    let b = bins.get(key);
    if (!b) {
      b = { samples: [], parasitic: [] };
      bins.set(key, b);
    }
    b.samples.push(s);
    if (s.victron48vPower < 0) b.parasitic.push(s);
  }

  const byBin: ParasiticBin[] = [];
  let totalDrainWh = 0;
  for (const [voltage, b] of bins) {
    const sampleCount = b.samples.length;
    const parasiticCount = b.parasitic.length;
    const parasiticPct = sampleCount > 0 ? (parasiticCount / sampleCount) * 100 : 0;
    const meanShuntW = sampleCount > 0
      ? b.samples.reduce((sum, s) => sum + (s.victron48vPower ?? 0), 0) / sampleCount
      : 0;
    // Drain: integrate -victron_48v_power over parasitic samples, assuming 1Hz (1 sample = 1 second)
    const drainJ = b.parasitic.reduce((sum, s) => sum + -(s.victron48vPower ?? 0), 0);
    const drainWh = drainJ / 3600;
    totalDrainWh += drainWh;
    byBin.push({ voltage, sampleCount, parasiticCount, parasiticPct, meanShuntW, drainWh });
  }
  byBin.sort((a, b) => a.voltage - b.voltage);

  // Find the highest bin that meets the threshold AND has enough samples
  let ceilingV: number | null = null;
  for (const bin of byBin) {
    if (bin.sampleCount >= minSamples && bin.parasiticPct >= threshold) {
      // Ceiling is the upper edge of this bin (voltage + binWidth)
      ceilingV = bin.voltage + binWidth;
    }
  }

  return { ceilingV, totalDrainWh, byBin };
}
