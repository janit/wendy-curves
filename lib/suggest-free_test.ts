import { assertEquals, assertAlmostEquals } from "@std/assert";
import { suggestFreeCurve, type FreeSuggestOptions } from "./suggest-free.ts";
import type { EnvelopeBin } from "./envelope.ts";
import type { StallHotspot } from "./stalls.ts";
import type { CurvePoint } from "./types.ts";

// ---- Helpers ----------------------------------------------------------------

function bin(v: number, p: number, n = 100): EnvelopeBin {
  return {
    voltage: v,
    sampleCount: n,
    pMedian: p,
    pP90: p,
    pMax: p,
    confidence: 1 - Math.exp(-n / 30), // high confidence for n=100
  };
}

function defaultOpts(overrides: Partial<FreeSuggestOptions> = {}): FreeSuggestOptions {
  return {
    targetPointCount: 16,
    maxPower: 5000,
    hotspotBackoff: 0.85,
    confidenceThreshold: 0.3,
    firstVoltage: 49.5,
    maxVoltage: 140,
    parasiticCeilingV: null,
    parasiticFloorW: 0,
    extrapolationFallback: null,
    ...overrides,
  };
}

function isMonotonic(points: CurvePoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (points[i].power < points[i - 1].power) return false;
  }
  return true;
}

// ---- Test 1: Empty envelope -------------------------------------------------

Deno.test("empty envelope falls back to extrapolation / floor only", () => {
  const result = suggestFreeCurve([], [], defaultOpts());

  assertEquals(result.length, 16, "result must have 16 setpoints");
  assertEquals(result[0].voltage, 49.5, "first setpoint must be firstVoltage");
  assertEquals(result[result.length - 1].voltage, 140, "last setpoint must be maxVoltage");

  // All powers within [0, maxPower].
  for (const pt of result) {
    assertEquals(pt.power >= 0, true, `power at ${pt.voltage}V must be >= 0`);
    assertEquals(pt.power <= 5000, true, `power at ${pt.voltage}V must be <= maxPower`);
  }

  // Monotonic.
  assertEquals(isMonotonic(result), true, "result must be monotonic non-decreasing");

  // Voltages span firstVoltage to maxVoltage.
  assertEquals(result[0].voltage <= 49.5, true);
  assertEquals(result[result.length - 1].voltage >= 140, true);
});

// ---- Test 2: Simple linear envelope ----------------------------------------

Deno.test("simple flat (linear) envelope produces proportional setpoints", () => {
  // 20 bins from 60V to 98V (2V apart), p90 linearly 10W..200W.
  const envelope: EnvelopeBin[] = [];
  for (let i = 0; i < 20; i++) {
    const v = 60 + i * 2;         // 60, 62, 64, … 98
    const p = 10 + i * (190 / 19); // 10W at 60V, 200W at 98V
    envelope.push(bin(v, p));
  }

  const result = suggestFreeCurve(envelope, [], defaultOpts());

  assertEquals(result.length, 16, "result must have 16 setpoints");
  assertEquals(result[0].voltage, 49.5, "first setpoint must be 49.5 (floor)");
  assertEquals(result[result.length - 1].voltage, 140, "last setpoint must be 140");

  // Setpoints in the observed region (60–98V) should track linearly within a few watts.
  for (const pt of result) {
    if (pt.voltage >= 60 && pt.voltage <= 98) {
      const frac = (pt.voltage - 60) / (98 - 60);
      const expected = 10 + frac * 190;
      // Allow ±15W tolerance (interpolation + rounding).
      assertEquals(
        Math.abs(pt.power - expected) <= 15,
        true,
        `at ${pt.voltage}V: expected ~${expected.toFixed(1)}W, got ${pt.power}W`,
      );
    }
  }

  assertEquals(isMonotonic(result), true, "result must be monotonic");
});

// ---- Test 3: Parasitic floor zeroes low-V setpoints -------------------------

Deno.test("parasitic floor zeroes out setpoints at or below parasiticCeilingV", () => {
  // Envelope starts at 60V (no low-V data).
  const envelope: EnvelopeBin[] = [
    bin(60, 20),
    bin(70, 50),
    bin(80, 80),
    bin(90, 120),
  ];

  const result = suggestFreeCurve(
    envelope,
    [],
    defaultOpts({ parasiticCeilingV: 55, parasiticFloorW: 0 }),
  );

  assertEquals(result.length, 16);

  // Any setpoint at V <= 55 must have power = 0.
  for (const pt of result) {
    if (pt.voltage <= 55) {
      assertEquals(
        pt.power,
        0,
        `setpoint at ${pt.voltage}V should be 0W (parasitic floor)`,
      );
    }
  }
});

// ---- Test 4: Hotspot back-off -----------------------------------------------

Deno.test("hotspot back-off reduces power in flagged bands", () => {
  // Linear envelope 10W at 60V → 200W at 100V (5V bins).
  const envelope: EnvelopeBin[] = [];
  for (let i = 0; i <= 8; i++) {
    const v = 60 + i * 5; // 60, 65, 70, 75, 80, 85, 90, 95, 100
    const p = 10 + i * (190 / 8);
    envelope.push(bin(v, p));
  }

  const hotspot: StallHotspot = { vBand: [70, 75], count: 10 };

  const result = suggestFreeCurve(
    envelope,
    [hotspot],
    defaultOpts({ hotspotBackoff: 0.5, confidenceThreshold: 0.3 }),
  );

  // The setpoint whose voltage falls in [70, 75) should be backed off.
  const hotspotPt = result.find((pt) => pt.voltage >= 70 && pt.voltage < 75);
  if (hotspotPt !== undefined) {
    // Envelope at 70V is the 3rd bin: 10 + 2*(190/8) ≈ 57.5W.
    // With 50% back-off the power should be roughly 28–29W, certainly well below 57W.
    assertEquals(
      hotspotPt.power < 50,
      true,
      `hotspot setpoint at ${hotspotPt.voltage}V should be backed off; got ${hotspotPt.power}W`,
    );
    // And it should be less than its immediate neighbours (raw envelope) would suggest without backoff.
    const fullEnvAtV = 10 + ((hotspotPt.voltage - 60) / (100 - 60)) * 190;
    assertEquals(
      hotspotPt.power < fullEnvAtV,
      true,
      "hotspot point should be less than raw envelope value",
    );
  }

  assertEquals(isMonotonic(result), true, "result must be monotonic non-decreasing");
});

// ---- Test 5: Monotonicity enforced ------------------------------------------

Deno.test("monotonicity enforced even with a deliberate dip in the envelope", () => {
  // Envelope with a dip at 85V.
  const envelope: EnvelopeBin[] = [
    bin(60, 10),
    bin(70, 30),
    bin(80, 50),
    bin(85, 40), // deliberate dip
    bin(90, 60),
    bin(100, 90),
  ];

  const result = suggestFreeCurve(envelope, [], defaultOpts());

  assertEquals(result.length, 16);
  assertEquals(isMonotonic(result), true, "output powers must be monotonic non-decreasing despite envelope dip");

  // All powers within valid range.
  for (const pt of result) {
    assertEquals(pt.power >= 0, true);
    assertEquals(pt.power <= 5000, true);
  }
});

// ---- Test 6: Extrapolation fallback respected --------------------------------

Deno.test("extrapolation fallback voltages and wattages are used verbatim", () => {
  // Envelope observed only up to ~90V.
  const envelope: EnvelopeBin[] = [
    bin(60, 20),
    bin(70, 50),
    bin(80, 90),
    bin(90, 130),
  ];

  const fallback: CurvePoint[] = [
    { voltage: 100, power: 250 },
    { voltage: 120, power: 1500 },
    { voltage: 140, power: 5000 },
  ];

  const result = suggestFreeCurve(
    envelope,
    [],
    defaultOpts({ extrapolationFallback: fallback }),
  );

  assertEquals(result.length, 16);

  // The result must include setpoints at 100, 120, and 140 with the exact fallback values.
  for (const fp of fallback) {
    const match = result.find((pt) => pt.voltage === fp.voltage);
    assertEquals(
      match !== undefined,
      true,
      `result must include a setpoint at ${fp.voltage}V`,
    );
    assertEquals(
      match!.power,
      fp.power,
      `setpoint at ${fp.voltage}V should have power=${fp.power}W`,
    );
  }
});
