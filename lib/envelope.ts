import type { Sample } from "./types.ts";

export interface EnvelopeBin {
  voltage: number;        // bin lower edge
  sampleCount: number;
  pMedian: number;
  pP90: number;
  pMax: number;
  confidence: number;     // 0..1
}

export interface EnvelopeOptions {
  binWidth: number;
  minVoltage: number;
}

/** Group samples into voltage bins keyed by the bin's lower edge. */
export function binSamples(samples: Sample[], binWidth: number): Map<number, Sample[]> {
  const bins = new Map<number, Sample[]>();
  for (const s of samples) {
    if (s.arrayVoltage == null || s.tristarPower == null) continue;
    const edge = Math.floor(s.arrayVoltage / binWidth) * binWidth;
    // Snap to single decimal to avoid float keys like 100.30000000000001
    const key = Math.round(edge * 10) / 10;
    let arr = bins.get(key);
    if (!arr) {
      arr = [];
      bins.set(key, arr);
    }
    arr.push(s);
  }
  return bins;
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

/** Filter MPPT-only, above-min-voltage samples and compute the envelope. */
export function envelopeFromSamples(samples: Sample[], opts: EnvelopeOptions): EnvelopeBin[] {
  const filtered = samples.filter((s) =>
    s.chargeState === "mppt" &&
    s.arrayVoltage != null &&
    s.arrayVoltage >= opts.minVoltage &&
    s.tristarPower != null
  );
  const bins = binSamples(filtered, opts.binWidth);
  const result: EnvelopeBin[] = [];
  for (const [voltage, bucket] of bins) {
    const powers = bucket
      .map((s) => s.tristarPower as number)
      .filter((p) => Number.isFinite(p))
      .sort((a, b) => a - b);
    if (powers.length === 0) continue;
    result.push({
      voltage,
      sampleCount: powers.length,
      pMedian: percentile(powers, 0.5),
      pP90: percentile(powers, 0.9),
      pMax: powers[powers.length - 1],
      confidence: 1 - Math.exp(-powers.length / 30),
    });
  }
  result.sort((a, b) => a.voltage - b.voltage);
  return result;
}
