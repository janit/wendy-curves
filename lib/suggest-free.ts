import type { CurvePoint } from "./types.ts";
import type { EnvelopeBin } from "./envelope.ts";
import type { StallHotspot } from "./stalls.ts";
import { isotonicNonDecreasing } from "./suggest.ts";

export interface FreeSuggestOptions {
  targetPointCount: number;      // default 16
  maxPower: number;              // hardware ceiling, default 5000
  hotspotBackoff: number;        // default 0.85 (15% back-off in stall bands)
  confidenceThreshold: number;   // default 0.3 — bins below this don't drive setpoint placement
  firstVoltage: number;          // default 49.5 — mandatory first setpoint voltage
  maxVoltage: number;            // default 140 — mandatory last setpoint voltage
  parasiticCeilingV: number | null; // if provided, setpoints at or below this are forced to parasiticFloorW
  parasiticFloorW: number;       // power to use at/below parasiticCeilingV, default 0
  extrapolationFallback: CurvePoint[] | null; // if provided, used to fill setpoints above max observed voltage
}

export function suggestFreeCurve(
  envelope: EnvelopeBin[],
  hotspots: StallHotspot[],
  opts: FreeSuggestOptions,
): CurvePoint[] {
  // ---- Step 1: Filter and smooth the envelope --------------------------------

  // Drop bins with confidence below the threshold.
  const trusted = envelope
    .filter((b) => b.confidence >= opts.confidenceThreshold)
    .sort((a, b) => a.voltage - b.voltage);

  // Apply isotonic regression to pP90 so the smoothed curve is non-decreasing.
  const smoothedValues = trusted.length > 0
    ? isotonicNonDecreasing(trusted.map((b) => b.pP90))
    : [];

  const trustedSmoothed: { voltage: number; pP90Smoothed: number; confidence: number }[] =
    trusted.map((b, i) => ({
      voltage: b.voltage,
      pP90Smoothed: smoothedValues[i],
      confidence: b.confidence,
    }));

  // ---- Step 2: Determine the observed voltage range --------------------------

  const observedMin = trustedSmoothed.length > 0
    ? trustedSmoothed[0].voltage
    : opts.firstVoltage;
  const observedMax = trustedSmoothed.length > 0
    ? trustedSmoothed[trustedSmoothed.length - 1].voltage
    : opts.firstVoltage;

  // ---- Step 3: Place setpoint voltages using greedy max-error ----------------

  // Count how many slots the extrapolation region will use.
  let N_extrap: number;
  if (opts.extrapolationFallback !== null) {
    N_extrap = opts.extrapolationFallback.filter((p) => p.voltage > observedMax).length;
    // If the fallback has no points above observedMax, still reserve a small default.
    if (N_extrap === 0) N_extrap = 3;
  } else {
    N_extrap = 3;
  }

  // Reserve 1 slot for the mandatory firstVoltage if it's below observedMin.
  const N_floor = opts.firstVoltage < observedMin ? 1 : 0;

  // Slots available for the "observed" region.
  const N_observed = Math.max(2, opts.targetPointCount - N_extrap - N_floor);

  // Start with the endpoints of the observed range.
  let setpointVoltages: number[] = observedMin === observedMax
    ? [observedMin]
    : [observedMin, observedMax];

  // Helper: linearly interpolate from the current setpoints.
  function interpolateAtV(v: number, spVoltages: number[]): number {
    // All setpoints have power computed by interpolating trustedSmoothed.
    // Here we only need the voltage positions — we interpolate pP90Smoothed from trustedSmoothed.
    // But the greedy algorithm needs to compare against the envelope, so we interpolate
    // the pP90Smoothed values at the current setpoints first, then interpolate between them.
    const spPowers = spVoltages.map((sv) => interpolateEnvelopeSmoothed(trustedSmoothed, sv));

    if (spVoltages.length === 0) return 0;
    if (v <= spVoltages[0]) return spPowers[0];
    if (v >= spVoltages[spVoltages.length - 1]) return spPowers[spPowers.length - 1];
    for (let i = 1; i < spVoltages.length; i++) {
      if (v <= spVoltages[i]) {
        const frac = (v - spVoltages[i - 1]) / (spVoltages[i] - spVoltages[i - 1]);
        return spPowers[i - 1] + frac * (spPowers[i] - spPowers[i - 1]);
      }
    }
    return 0;
  }

  // Greedily add voltages from the trusted envelope that have maximum interpolation error.
  while (setpointVoltages.length < N_observed && trustedSmoothed.length > 0) {
    let maxError = -1;
    let bestV = -1;

    for (const bin of trustedSmoothed) {
      const v = bin.voltage;
      // Skip voltages already in the setpoint list.
      if (setpointVoltages.includes(v)) continue;
      const interpolated = interpolateAtV(v, setpointVoltages);
      const error = Math.abs(bin.pP90Smoothed - interpolated);
      if (error > maxError) {
        maxError = error;
        bestV = v;
      }
    }

    if (bestV < 0) break; // No more candidates.
    setpointVoltages.push(bestV);
    setpointVoltages.sort((a, b) => a - b);
  }

  // ---- Step 4: Add mandatory floor and extrapolation setpoints ---------------

  // Prepend firstVoltage if it's below the observed minimum.
  if (opts.firstVoltage < observedMin) {
    setpointVoltages.unshift(opts.firstVoltage);
  }

  // Add parasiticCeilingV if it falls at or above firstVoltage.
  if (
    opts.parasiticCeilingV !== null &&
    opts.parasiticCeilingV >= opts.firstVoltage &&
    !setpointVoltages.includes(opts.parasiticCeilingV)
  ) {
    setpointVoltages.push(opts.parasiticCeilingV);
  }

  // Add extrapolation setpoints above observedMax.
  if (opts.extrapolationFallback !== null) {
    const extraPoints = opts.extrapolationFallback.filter((p) => p.voltage > observedMax);
    for (const p of extraPoints) {
      if (!setpointVoltages.includes(p.voltage)) {
        setpointVoltages.push(p.voltage);
      }
    }
  } else {
    // Generate N_extrap linearly-spaced voltages from observedMax to maxVoltage,
    // skipping observedMax itself.
    if (N_extrap > 0) {
      // We want N_extrap points in (observedMax, maxVoltage].
      // When N_extrap === 1, just add maxVoltage.
      const step = (opts.maxVoltage - observedMax) / N_extrap;
      for (let k = 1; k <= N_extrap; k++) {
        const v = observedMax + k * step;
        const rounded = Math.round(v * 10) / 10;
        if (!setpointVoltages.includes(rounded)) {
          setpointVoltages.push(rounded);
        }
      }
    }
  }

  // Ensure maxVoltage is always present.
  if (!setpointVoltages.includes(opts.maxVoltage)) {
    setpointVoltages.push(opts.maxVoltage);
  }

  // Deduplicate and sort.
  setpointVoltages = [...new Set(setpointVoltages)].sort((a, b) => a - b);

  // Trim or expand to exactly targetPointCount, preferring changes in the
  // sparse extrapolation region (voltages above observedMax, excluding endpoints).
  const target = opts.targetPointCount;

  while (setpointVoltages.length > target) {
    // Remove the voltage with the most "redundant" position.
    // Prefer removing from the extrapolation region, excluding firstVoltage and maxVoltage.
    let removeIdx = -1;

    // First pass: look for interior extrapolation region points.
    for (let i = 1; i < setpointVoltages.length - 1; i++) {
      const v = setpointVoltages[i];
      if (v > observedMax) {
        removeIdx = i;
        break;
      }
    }

    // Second pass: if none above observedMax, remove the most redundant observed interior point.
    if (removeIdx < 0) {
      removeIdx = 1; // Default: remove second point (safe interior).
    }

    setpointVoltages.splice(removeIdx, 1);
  }

  while (setpointVoltages.length < target) {
    // Insert a new point in the largest gap, preferring the extrapolation region.
    let bestGapIdx = -1;
    let bestGapSize = -1;

    for (let i = 0; i < setpointVoltages.length - 1; i++) {
      const gap = setpointVoltages[i + 1] - setpointVoltages[i];
      if (gap > bestGapSize) {
        bestGapSize = gap;
        bestGapIdx = i;
      }
    }

    if (bestGapIdx < 0) break;

    const midV = (setpointVoltages[bestGapIdx] + setpointVoltages[bestGapIdx + 1]) / 2;
    const rounded = Math.round(midV * 10) / 10;
    setpointVoltages.splice(bestGapIdx + 1, 0, rounded);
  }

  // ---- Step 5: Compute wattage at each selected voltage ----------------------

  // Find last two trusted envelope points for extrapolation slope.
  let extrapolationSlope = 0;
  let extrapolationBase: { voltage: number; power: number } | null = null;
  if (trustedSmoothed.length >= 2) {
    const last = trustedSmoothed[trustedSmoothed.length - 1];
    const secondLast = trustedSmoothed[trustedSmoothed.length - 2];
    const dv = last.voltage - secondLast.voltage;
    if (dv > 0) {
      extrapolationSlope = (last.pP90Smoothed - secondLast.pP90Smoothed) / dv;
    }
    extrapolationBase = { voltage: last.voltage, power: last.pP90Smoothed };
  } else if (trustedSmoothed.length === 1) {
    extrapolationBase = { voltage: trustedSmoothed[0].voltage, power: trustedSmoothed[0].pP90Smoothed };
  }

  const points: CurvePoint[] = setpointVoltages.map((v) => {
    let power: number;

    if (opts.parasiticCeilingV !== null && v <= opts.parasiticCeilingV) {
      // Floor zone.
      power = opts.parasiticFloorW;
    } else if (trustedSmoothed.length > 0 && v >= observedMin && v <= observedMax) {
      // Observed zone: interpolate the smoothed envelope.
      power = interpolateEnvelopeSmoothed(trustedSmoothed, v);
      // Apply hotspot back-off if this voltage falls in a stall hotspot band.
      if (inHotspot(v, hotspots)) {
        power = power * opts.hotspotBackoff;
      }
    } else if (trustedSmoothed.length === 0 || v > observedMax) {
      // Extrapolation zone.
      if (opts.extrapolationFallback !== null) {
        // Look for an exact match in the fallback.
        const exact = opts.extrapolationFallback.find((p) => p.voltage === v);
        if (exact !== undefined) {
          power = exact.power;
        } else {
          // Interpolate/extrapolate within the fallback points.
          power = interpolateFallback(opts.extrapolationFallback, v, opts.maxPower);
        }
      } else if (extrapolationBase !== null) {
        // Linear extrapolation from the last two envelope points.
        power = extrapolationBase.power + extrapolationSlope * (v - extrapolationBase.voltage);
        power = Math.min(power, opts.maxPower);
      } else {
        // No data at all — use 0 for everything below maxVoltage, maxPower at maxVoltage.
        // Corner case: empty envelope and no fallback. Spread 0..maxPower linearly.
        const frac = (v - opts.firstVoltage) / (opts.maxVoltage - opts.firstVoltage);
        power = frac * opts.maxPower;
      }
    } else {
      // v < observedMin and not in the floor zone — interpolate from the floor toward observedMin.
      power = interpolateEnvelopeSmoothed(trustedSmoothed, v);
    }

    return { voltage: v, power };
  });

  // ---- Step 6: Enforce monotonicity and clamp --------------------------------

  const monotonic = isotonicNonDecreasing(points.map((p) => p.power));
  return points.map((p, i) => ({
    voltage: p.voltage,
    power: Math.round(Math.max(0, Math.min(monotonic[i], opts.maxPower))),
  }));
}

// ---- Helpers ----------------------------------------------------------------

/** Linearly interpolate pP90Smoothed from the trusted envelope at voltage v. */
function interpolateEnvelopeSmoothed(
  trusted: { voltage: number; pP90Smoothed: number }[],
  v: number,
): number {
  if (trusted.length === 0) return 0;
  if (v <= trusted[0].voltage) return trusted[0].pP90Smoothed;
  if (v >= trusted[trusted.length - 1].voltage) return trusted[trusted.length - 1].pP90Smoothed;
  for (let i = 1; i < trusted.length; i++) {
    if (v <= trusted[i].voltage) {
      const a = trusted[i - 1];
      const b = trusted[i];
      const frac = (v - a.voltage) / (b.voltage - a.voltage);
      return a.pP90Smoothed + frac * (b.pP90Smoothed - a.pP90Smoothed);
    }
  }
  return trusted[trusted.length - 1].pP90Smoothed;
}

/** Interpolate / extrapolate within a CurvePoint[] fallback array. */
function interpolateFallback(fallback: CurvePoint[], v: number, maxPower: number): number {
  if (fallback.length === 0) return 0;
  const sorted = [...fallback].sort((a, b) => a.voltage - b.voltage);
  if (v <= sorted[0].voltage) return sorted[0].power;
  if (v >= sorted[sorted.length - 1].voltage) return sorted[sorted.length - 1].power;
  for (let i = 1; i < sorted.length; i++) {
    if (v <= sorted[i].voltage) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const frac = (v - a.voltage) / (b.voltage - a.voltage);
      return Math.min(a.power + frac * (b.power - a.power), maxPower);
    }
  }
  return Math.min(sorted[sorted.length - 1].power, maxPower);
}

/** Returns true if voltage v falls inside any stall hotspot band. */
function inHotspot(v: number, hotspots: StallHotspot[]): boolean {
  for (const h of hotspots) {
    if (v >= h.vBand[0] && v < h.vBand[1]) return true;
  }
  return false;
}
