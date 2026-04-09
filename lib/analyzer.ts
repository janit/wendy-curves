import type { Sample, CurvePoint } from "./types.ts";
import { envelopeFromSamples, type EnvelopeBin } from "./envelope.ts";
import { detectStalls, clusterStallHotspots, type StallHotspot } from "./stalls.ts";
import { suggestCurve } from "./suggest.ts";

export interface CurveMetrics {
  window: { tsFrom: number; tsTo: number; sampleCount: number; mpptSampleCount: number };
  energy: { kwh: number; peakW: number; meanWInMppt: number };
  envelope: EnvelopeBin[];
  curveFit: { binsAboveCurve: number; binsBelowCurve: number; rmseW: number };
  stalls: { count: number; hotspots: StallHotspot[] };
  recommendation: CurvePoint[] | null;
}

export interface AnalyzerOptions {
  binWidth: number;
  minVoltage: number;
  maxPower: number;
  perPointJumpFactor: number;
  analyzerVersion: number;
}

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

export function analyze(samples: Sample[], curve: CurvePoint[], opts: AnalyzerOptions): CurveMetrics {
  const tsFrom = samples.length > 0 ? samples[0].ts : 0;
  const tsTo = samples.length > 0 ? samples[samples.length - 1].ts : 0;

  const mpptSamples = samples.filter((s) =>
    s.chargeState === "mppt" && s.tristarPower != null && s.tristarPower >= 0
  );

  // Energy: integrate W·s, convert to kWh. Assumes 1Hz spacing.
  let energyJ = 0;
  let peakW = 0;
  let sumW = 0;
  for (const s of mpptSamples) {
    const p = s.tristarPower ?? 0;
    energyJ += p; // 1 second per sample
    if (p > peakW) peakW = p;
    sumW += p;
  }
  const kwh = energyJ / 3_600_000;
  const meanWInMppt = mpptSamples.length > 0 ? sumW / mpptSamples.length : 0;

  // Envelope
  const envelope = envelopeFromSamples(samples, {
    binWidth: opts.binWidth,
    minVoltage: opts.minVoltage,
  });

  // Curve fit
  let above = 0;
  let below = 0;
  let sqErr = 0;
  let confSum = 0;
  for (const bin of envelope) {
    const target = curvePowerAt(curve, bin.voltage);
    if (bin.pP90 > target) above++;
    else if (bin.pP90 < target) below++;
    const err = bin.pP90 - target;
    sqErr += err * err * bin.confidence;
    confSum += bin.confidence;
  }
  const rmseW = confSum > 0 ? Math.sqrt(sqErr / confSum) : 0;

  // Stalls
  const stalls = detectStalls(samples, curve, {
    windowSeconds: 10,
    voltageDropV: 8,
    powerFractionOfCurve: 0.7,
    minVoltage: 50,
  });
  const hotspots = clusterStallHotspots(stalls, 5);

  // Recommendation (only when we have envelope data)
  const recommendation = envelope.length > 0
    ? suggestCurve(curve, envelope, hotspots, {
      maxPower: opts.maxPower,
      perPointJumpFactor: opts.perPointJumpFactor,
    })
    : null;

  return {
    window: {
      tsFrom, tsTo,
      sampleCount: samples.length,
      mpptSampleCount: mpptSamples.length,
    },
    energy: { kwh, peakW, meanWInMppt },
    envelope,
    curveFit: { binsAboveCurve: above, binsBelowCurve: below, rmseW },
    stalls: { count: stalls.length, hotspots },
    recommendation,
  };
}

export interface VerdictOptions {
  minMpptHours: number;
}

export interface Verdict {
  label: "BETTER" | "WORSE" | "MIXED" | "INSUFFICIENT_DATA" | "INCOMPARABLE";
  detail: { kwhPerHourDelta: number; stallsPerDayDelta: number };
}

export function computeVerdict(active: CurveMetrics, previous: CurveMetrics, opts: VerdictOptions): Verdict {
  const minSeconds = opts.minMpptHours * 3600;
  if (active.window.mpptSampleCount < minSeconds || previous.window.mpptSampleCount < minSeconds) {
    return { label: "INSUFFICIENT_DATA", detail: { kwhPerHourDelta: 0, stallsPerDayDelta: 0 } };
  }
  const aHours = active.window.mpptSampleCount / 3600;
  const pHours = previous.window.mpptSampleCount / 3600;
  const aKwhPerHour = active.energy.kwh / aHours;
  const pKwhPerHour = previous.energy.kwh / pHours;
  const kwhDelta = aKwhPerHour - pKwhPerHour;

  const aStallsPerDay = (active.stalls.count / aHours) * 24;
  const pStallsPerDay = (previous.stalls.count / pHours) * 24;
  const stallsDelta = aStallsPerDay - pStallsPerDay;

  const energyBetter = kwhDelta > 0;
  const stallsBetter = stallsDelta < 0;

  let label: Verdict["label"];
  if (energyBetter && stallsBetter) label = "BETTER";
  else if (!energyBetter && !stallsBetter && (kwhDelta < 0 || stallsDelta > 0)) label = "WORSE";
  else if (kwhDelta === 0 && stallsDelta === 0) label = "INSUFFICIENT_DATA";
  else label = "MIXED";

  return {
    label,
    detail: { kwhPerHourDelta: kwhDelta, stallsPerDayDelta: stallsDelta },
  };
}
