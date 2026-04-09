import type { Sample } from "./types.ts";

export interface MarsrockBin {
  voltage: number;       // lower edge of bin
  sampleCount: number;
  pMedian: number;
  pP90: number;
  pMax: number;
}

export interface DualInsights {
  window: {
    tsFrom: number;
    tsTo: number;
    totalSamples: number;
  };
  marsrock: {
    bins: MarsrockBin[];
    harvestWh: number;    // total positive 24V harvest during 24V mode, converted to Wh (1Hz assumption)
    peakW: number;
    activeSamples: number; // count of samples where Marsrock was harvesting (24v mode, positive shunt)
  };
  tristar: {
    harvestWh: number;    // total positive 48V harvest during 48V mode
    peakW: number;
    activeSamples: number;
  };
  coil: {
    drainWh: number;      // total |negative 24V power| during 48V mode (relay coil draw)
    meanDrainW: number;   // average draw while coil is active
    sampleCount: number;  // samples with negative 24V power during 48V mode
  };
  modeDistribution: {
    in24v: number;        // sample count with mode='24v' AND either shunt has a reading
    in48v: number;        // sample count with mode='48v' AND either shunt has a reading
    total: number;        // all samples with any shunt reading (for pct computation)
  };
  raw: {
    scatterPoints: Array<{ voltage: number; power: number; mode: string }>;
    // Sampled-down (every Nth) list of (arrayVoltage, victron24vPower) for scatter rendering.
    // Cap at ~3000 points to keep response size manageable.
  };
}

export interface DualInsightsOptions {
  binWidth: number;         // default 1.0
  scatterMaxPoints: number; // default 3000 — downsample if we have more
}

/** Linear-interpolation percentile on a sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

export function computeDualInsights(
  samples: Sample[],
  opts?: Partial<DualInsightsOptions>,
): DualInsights {
  const binWidth = opts?.binWidth ?? 1.0;
  const scatterMaxPoints = opts?.scatterMaxPoints ?? 3000;

  // 1. Filter to samples that have BOTH victron_48v_power AND victron_24v_power non-null.
  //    This excludes bootstrap/archive rows which are tristar-only.
  const live = samples.filter(
    (s) => s.victron48vPower != null && s.victron24vPower != null,
  );

  // 2. Mode distribution
  let in24v = 0;
  let in48v = 0;
  for (const s of live) {
    if (s.mode === "24v") in24v++;
    else if (s.mode === "48v") in48v++;
  }
  const total = live.length;

  // 3. Marsrock scatter and bins: mode='24v' AND victron_24v_power > 0 AND arrayVoltage != null
  // Harvest uses the monotonic charged counter delta (kWh → Wh).
  // The BMV counter ticks up on any charge flow regardless of loads,
  // so this gives the real harvest even when 24V loads are masking
  // the net shunt reading.
  let marsrockPeakW = 0;
  let marsrockActiveSamples = 0;
  const voltageBins = new Map<number, number[]>();

  for (const s of live) {
    if (s.mode !== "24v" || s.victron24vPower == null || s.victron24vPower <= 0) continue;
    if (s.victron24vPower > marsrockPeakW) marsrockPeakW = s.victron24vPower;
    marsrockActiveSamples++;

    if (s.arrayVoltage == null) continue;
    const edge = Math.floor(s.arrayVoltage / binWidth) * binWidth;
    const key = Math.round(edge * 10) / 10;
    let arr = voltageBins.get(key);
    if (!arr) {
      arr = [];
      voltageBins.set(key, arr);
    }
    arr.push(s.victron24vPower);
  }

  let marsrockHarvestWh = 0;
  {
    let first: number | null = null;
    let last: number | null = null;
    for (const s of samples) {
      if (s.victronChargedKwh == null) continue;
      if (first === null) first = s.victronChargedKwh;
      last = s.victronChargedKwh;
    }
    if (first !== null && last !== null) {
      marsrockHarvestWh = Math.max(0, (last - first) * 1000);
    }
  }

  const marsrockBins: MarsrockBin[] = [];
  for (const [voltage, powers] of voltageBins) {
    const sorted = powers.slice().sort((a, b) => a - b);
    marsrockBins.push({
      voltage,
      sampleCount: sorted.length,
      pMedian: percentile(sorted, 0.5),
      pP90: percentile(sorted, 0.9),
      pMax: sorted[sorted.length - 1],
    });
  }
  marsrockBins.sort((a, b) => a.voltage - b.voltage);

  // 4. TriStar side: mode='48v' AND victron_48v_power > 0
  // Harvest uses the monotonic 48V charged counter delta (kWh → Wh).
  let tristarPeakW = 0;
  let tristarActiveSamples = 0;

  for (const s of live) {
    if (s.mode !== "48v" || s.victron48vPower == null || s.victron48vPower <= 0) continue;
    if (s.victron48vPower > tristarPeakW) tristarPeakW = s.victron48vPower;
    tristarActiveSamples++;
  }

  let tristarHarvestWh = 0;
  {
    let first: number | null = null;
    let last: number | null = null;
    for (const s of samples) {
      if (s.victron48vChargedKwh == null) continue;
      if (first === null) first = s.victron48vChargedKwh;
      last = s.victron48vChargedKwh;
    }
    if (first !== null && last !== null) {
      tristarHarvestWh = Math.max(0, (last - first) * 1000);
    }
  }

  // 5. Coil drain: mode='48v' AND victron_24v_power < 0
  let coilDrainWh = 0;
  let coilDrainSum = 0;
  let coilSampleCount = 0;

  for (const s of live) {
    if (s.mode !== "48v" || s.victron24vPower == null || s.victron24vPower >= 0) continue;
    const draw = -s.victron24vPower;
    coilDrainWh += draw / 3600;
    coilDrainSum += draw;
    coilSampleCount++;
  }

  const coilMeanDrainW = coilSampleCount > 0 ? coilDrainSum / coilSampleCount : 0;

  // 6. Raw scatter points: ALL live samples with mode='24v' AND victron_24v_power != null AND arrayVoltage != null
  const allScatter: Array<{ voltage: number; power: number; mode: string }> = [];
  for (const s of live) {
    if (s.mode !== "24v" || s.victron24vPower == null || s.arrayVoltage == null) continue;
    allScatter.push({
      voltage: s.arrayVoltage,
      power: s.victron24vPower,
      mode: s.mode,
    });
  }

  let scatterPoints: Array<{ voltage: number; power: number; mode: string }>;
  if (allScatter.length <= scatterMaxPoints) {
    scatterPoints = allScatter;
  } else {
    const stride = Math.ceil(allScatter.length / scatterMaxPoints);
    scatterPoints = allScatter.filter((_, i) => i % stride === 0);
  }

  // Build window using ts range from original samples
  const tsFrom = samples.length > 0 ? samples[0].ts : 0;
  const tsTo = samples.length > 0 ? samples[samples.length - 1].ts : 0;

  return {
    window: {
      tsFrom,
      tsTo,
      totalSamples: samples.length,
    },
    marsrock: {
      bins: marsrockBins,
      harvestWh: marsrockHarvestWh,
      peakW: marsrockPeakW,
      activeSamples: marsrockActiveSamples,
    },
    tristar: {
      harvestWh: tristarHarvestWh,
      peakW: tristarPeakW,
      activeSamples: tristarActiveSamples,
    },
    coil: {
      drainWh: coilDrainWh,
      meanDrainW: coilMeanDrainW,
      sampleCount: coilSampleCount,
    },
    modeDistribution: {
      in24v,
      in48v,
      total,
    },
    raw: {
      scatterPoints,
    },
  };
}
