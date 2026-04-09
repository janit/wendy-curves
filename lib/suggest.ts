import type { CurvePoint } from "./types.ts";
import type { EnvelopeBin } from "./envelope.ts";
import type { StallHotspot } from "./stalls.ts";

export interface SuggestOptions {
  maxPower: number;
  perPointJumpFactor: number;  // e.g. 1.25
}

/**
 * Pool-adjacent-violators algorithm. Returns a non-decreasing array.
 * Each output element is the average of its pool.
 */
export function isotonicNonDecreasing(values: number[]): number[] {
  // Build pools as { sum, count }
  const pools: { sum: number; count: number }[] = values.map((v) => ({ sum: v, count: 1 }));
  let i = 0;
  while (i < pools.length - 1) {
    const meanA = pools[i].sum / pools[i].count;
    const meanB = pools[i + 1].sum / pools[i + 1].count;
    if (meanA <= meanB) {
      i++;
      continue;
    }
    // Merge i+1 into i
    pools[i] = { sum: pools[i].sum + pools[i + 1].sum, count: pools[i].count + pools[i + 1].count };
    pools.splice(i + 1, 1);
    if (i > 0) i--;
  }
  // Expand pools back to per-element output
  const out: number[] = [];
  for (const p of pools) {
    const m = p.sum / p.count;
    for (let k = 0; k < p.count; k++) out.push(m);
  }
  return out;
}

function interpolateEnvelope(env: EnvelopeBin[], v: number): { p: number; conf: number } | null {
  if (env.length === 0) return null;
  // No data below the lowest envelope bin — fall back to active (return null)
  if (v < env[0].voltage) return null;
  if (v >= env[env.length - 1].voltage) {
    const last = env[env.length - 1];
    return { p: last.pP90, conf: last.confidence };
  }
  for (let i = 1; i < env.length; i++) {
    if (v <= env[i].voltage) {
      const a = env[i - 1];
      const b = env[i];
      const frac = (v - a.voltage) / (b.voltage - a.voltage);
      return {
        p: a.pP90 + frac * (b.pP90 - a.pP90),
        conf: a.confidence + frac * (b.confidence - a.confidence),
      };
    }
  }
  return null;
}

function inHotspot(v: number, hotspots: StallHotspot[]): boolean {
  for (const h of hotspots) {
    if (v >= h.vBand[0] && v < h.vBand[1]) return true;
  }
  return false;
}

/**
 * Build a suggested curve at the same setpoint voltages as the active
 * curve, applying envelope blend, hotspot back-off, monotonicity, and
 * the per-point jump clamp.
 */
export function suggestCurve(
  active: CurvePoint[],
  envelope: EnvelopeBin[],
  hotspots: StallHotspot[],
  opts: SuggestOptions,
): CurvePoint[] {
  // Step 1: blend active with envelope using confidence
  const raw: number[] = active.map((pt) => {
    const env = interpolateEnvelope(envelope, pt.voltage);
    if (!env) return pt.power;
    const alpha = env.conf;
    return alpha * env.p + (1 - alpha) * pt.power;
  });

  // Step 2: hotspot back-off (15%)
  for (let i = 0; i < raw.length; i++) {
    if (inHotspot(active[i].voltage, hotspots)) raw[i] = raw[i] * 0.85;
  }

  // Step 3: monotonic non-decreasing
  const monotonic = isotonicNonDecreasing(raw);

  // Step 4: clamp per-point jump and hardware max
  const final: CurvePoint[] = [];
  for (let i = 0; i < active.length; i++) {
    const cap = Math.min(opts.maxPower, active[i].power * opts.perPointJumpFactor);
    const power = Math.max(0, Math.min(monotonic[i], cap));
    final.push({ voltage: active[i].voltage, power: Math.floor(power) });
  }

  // Step 5: monotonic again (clamps may have re-introduced violations)
  const cleaned = isotonicNonDecreasing(final.map((p) => p.power));
  return final.map((p, i) => ({ voltage: p.voltage, power: Math.floor(cleaned[i]) }));
}
