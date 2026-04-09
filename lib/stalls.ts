import type { Sample, CurvePoint } from "./types.ts";

export interface Stall {
  tsStart: number;
  tsEnd: number;
  vCollapseFrom: number;
  vCollapseTo: number;
  pAtStart: number;
}

export interface StallHotspot {
  vBand: [number, number];
  count: number;
}

export interface StallOptions {
  windowSeconds: number;
  voltageDropV: number;        // collapse threshold (positive number)
  powerFractionOfCurve: number; // e.g. 0.7
  minVoltage: number;
}

/** Linear interpolation of power at a voltage given the curve setpoints. */
function curvePowerAt(curve: CurvePoint[], v: number): number {
  if (curve.length === 0) return 0;
  if (v <= curve[0].voltage) return curve[0].power;
  if (v >= curve[curve.length - 1].voltage) return curve[curve.length - 1].power;
  for (let i = 1; i < curve.length; i++) {
    if (v <= curve[i].voltage) {
      const a = curve[i - 1];
      const b = curve[i];
      const frac = (v - a.voltage) / (b.voltage - a.voltage);
      return a.power + frac * (b.power - a.power);
    }
  }
  return 0;
}

/**
 * Look at each ts and compare to the sample `windowSeconds` ago.
 * Stall = voltage dropped by >= voltageDropV AND the earlier sample was
 * carrying >= powerFractionOfCurve × curve(earlier voltage).
 */
export function detectStalls(samples: Sample[], curve: CurvePoint[], opts: StallOptions): Stall[] {
  const stalls: Stall[] = [];
  // Index by ts for quick lookup
  const byTs = new Map<number, Sample>();
  for (const s of samples) byTs.set(s.ts, s);

  for (const cur of samples) {
    if (cur.arrayVoltage == null || cur.arrayVoltage < opts.minVoltage) continue;
    const earlier = byTs.get(cur.ts - opts.windowSeconds);
    if (!earlier || earlier.arrayVoltage == null || earlier.tristarPower == null) continue;
    const drop = earlier.arrayVoltage - cur.arrayVoltage;
    if (drop < opts.voltageDropV) continue;
    const demand = curvePowerAt(curve, earlier.arrayVoltage) * opts.powerFractionOfCurve;
    if (earlier.tristarPower < demand) continue;
    stalls.push({
      tsStart: earlier.ts,
      tsEnd: cur.ts,
      vCollapseFrom: earlier.arrayVoltage,
      vCollapseTo: cur.arrayVoltage,
      pAtStart: earlier.tristarPower,
    });
  }
  return stalls;
}

/**
 * Group stalls into voltage hotspots, banded at every `bandWidth` volts.
 * Bands with no stalls are omitted. Sorted by count desc.
 */
export function clusterStallHotspots(stalls: Stall[], bandWidth: number): StallHotspot[] {
  const counts = new Map<number, number>();
  for (const s of stalls) {
    const lower = Math.floor(s.vCollapseFrom / bandWidth) * bandWidth;
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }
  const out: StallHotspot[] = [];
  for (const [lower, count] of counts) {
    out.push({ vBand: [lower, lower + bandWidth], count });
  }
  out.sort((a, b) => b.count - a.count || a.vBand[0] - b.vBand[0]);
  return out;
}
