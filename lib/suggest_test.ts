import { assertEquals } from "@std/assert";
import { suggestCurve, isotonicNonDecreasing } from "./suggest.ts";
import type { CurvePoint } from "./types.ts";
import type { EnvelopeBin } from "./envelope.ts";
import type { StallHotspot } from "./stalls.ts";

const ACTIVE: CurvePoint[] = [
  { voltage: 49.5, power: 2 },
  { voltage: 100, power: 250 },
  { voltage: 110, power: 600 },
  { voltage: 140, power: 5000 },
];

function envBin(v: number, p: number, n = 100): EnvelopeBin {
  return { voltage: v, sampleCount: n, pMedian: p, pP90: p, pMax: p, confidence: 1 - Math.exp(-n / 30) };
}

Deno.test("isotonicNonDecreasing pools adjacent violators", () => {
  const out = isotonicNonDecreasing([1, 5, 3, 4, 2, 6]);
  // Expected non-decreasing pooled means
  assertEquals(out.length, 6);
  for (let i = 1; i < out.length; i++) {
    assertEquals(out[i] >= out[i - 1], true);
  }
});

Deno.test("suggestCurve falls back to active where no envelope data", () => {
  const out = suggestCurve(ACTIVE, [], [], { maxPower: 5000, perPointJumpFactor: 1.25 });
  assertEquals(out.length, ACTIVE.length);
  for (let i = 0; i < out.length; i++) {
    assertEquals(out[i].voltage, ACTIVE[i].voltage);
    assertEquals(out[i].power, ACTIVE[i].power);
  }
});

Deno.test("suggestCurve never exceeds 1.25× active value at any setpoint", () => {
  const env: EnvelopeBin[] = [
    envBin(100, 9999),  // huge envelope at 100V
  ];
  const out = suggestCurve(ACTIVE, env, [], { maxPower: 5000, perPointJumpFactor: 1.25 });
  const at100 = out.find((p) => p.voltage === 100)!;
  // Active at 100 was 250 → max suggestion = 312
  assertEquals(at100.power <= 250 * 1.25, true);
});

Deno.test("suggestCurve enforces monotonic non-decreasing output", () => {
  const env: EnvelopeBin[] = [
    envBin(100, 1000),  // pushes 100V high
    envBin(110, 100),   // pushes 110V low (would create a dip)
  ];
  const out = suggestCurve(ACTIVE, env, [], { maxPower: 5000, perPointJumpFactor: 100 });
  for (let i = 1; i < out.length; i++) {
    assertEquals(out[i].power >= out[i - 1].power, true);
  }
});

Deno.test("suggestCurve clamps at maxPower", () => {
  const env: EnvelopeBin[] = [
    envBin(140, 999999),
  ];
  const out = suggestCurve(ACTIVE, env, [], { maxPower: 5000, perPointJumpFactor: 100 });
  const last = out[out.length - 1];
  assertEquals(last.power <= 5000, true);
});

Deno.test("suggestCurve backs off in stall hotspot bands by 15%", () => {
  const env: EnvelopeBin[] = [envBin(110, 600)];
  const hotspots: StallHotspot[] = [{ vBand: [110, 115], count: 5 }];
  const out = suggestCurve(ACTIVE, env, hotspots, { maxPower: 5000, perPointJumpFactor: 100 });
  const at110 = out.find((p) => p.voltage === 110)!;
  // Pre-clamp would be ~600 (active=600, blend with envelope of 600 high confidence)
  // After 0.85× hotspot back-off → ≤ 510
  assertEquals(at110.power <= 510, true);
});
