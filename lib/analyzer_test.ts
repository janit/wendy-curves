import { assertEquals } from "@std/assert";
import { analyze, computeVerdict, type CurveMetrics } from "./analyzer.ts";
import type { Sample, CurvePoint } from "./types.ts";

const CURVE: CurvePoint[] = [
  { voltage: 49.5, power: 2 },
  { voltage: 100, power: 250 },
  { voltage: 110, power: 600 },
  { voltage: 140, power: 5000 },
];

function s(ts: number, v: number, p: number, charge = "mppt"): Sample {
  return {
    ts, arrayVoltage: v, arrayCurrent: null, tristarPower: p,
    batteryVoltage: null, chargeState: charge, victron48vPower: null,
    victron24vPower: null, mode: null,
  };
}

Deno.test("analyze reports zero metrics on empty samples", () => {
  const m = analyze([], CURVE, { binWidth: 0.5, minVoltage: 49.5, maxPower: 5000, perPointJumpFactor: 1.25, analyzerVersion: 1 });
  assertEquals(m.window.sampleCount, 0);
  assertEquals(m.window.mpptSampleCount, 0);
  assertEquals(m.energy.kwh, 0);
});

Deno.test("analyze counts MPPT samples and computes kWh roughly", () => {
  // 60 seconds at 600W = 0.01 kWh (10 Wh)
  const samples: Sample[] = [];
  for (let t = 0; t < 60; t++) samples.push(s(t, 110, 600));
  const m = analyze(samples, CURVE, { binWidth: 0.5, minVoltage: 49.5, maxPower: 5000, perPointJumpFactor: 1.25, analyzerVersion: 1 });
  assertEquals(m.window.sampleCount, 60);
  assertEquals(m.window.mpptSampleCount, 60);
  // 600 W × 60 s = 36000 J = 0.01 kWh
  assertEquals(Math.round(m.energy.kwh * 10000), 100);
});

Deno.test("analyze produces an envelope and a recommendation", () => {
  const samples: Sample[] = [];
  for (let t = 0; t < 50; t++) samples.push(s(t, 110, 600));
  const m = analyze(samples, CURVE, { binWidth: 0.5, minVoltage: 49.5, maxPower: 5000, perPointJumpFactor: 1.25, analyzerVersion: 1 });
  assertEquals(m.envelope.length > 0, true);
  assertEquals(m.recommendation !== null, true);
  assertEquals(m.recommendation!.length, CURVE.length);
});

Deno.test("computeVerdict returns INSUFFICIENT_DATA below threshold", () => {
  const a: CurveMetrics = stub(60 * 60, 1.0, 0); // 1 hour
  const b: CurveMetrics = stub(60 * 60, 1.0, 0);
  const v = computeVerdict(a, b, { minMpptHours: 6 });
  assertEquals(v.label, "INSUFFICIENT_DATA");
});

Deno.test("computeVerdict returns BETTER when both kWh up and stalls down", () => {
  const a = stub(10 * 3600, 5.0, 2);  // current
  const b = stub(10 * 3600, 4.0, 8);  // previous
  const v = computeVerdict(a, b, { minMpptHours: 6 });
  assertEquals(v.label, "BETTER");
});

Deno.test("computeVerdict returns WORSE when both kWh down and stalls up", () => {
  const a = stub(10 * 3600, 3.0, 10);
  const b = stub(10 * 3600, 5.0, 2);
  const v = computeVerdict(a, b, { minMpptHours: 6 });
  assertEquals(v.label, "WORSE");
});

Deno.test("computeVerdict returns MIXED on disagreement", () => {
  const a = stub(10 * 3600, 5.5, 10); // more kWh, more stalls
  const b = stub(10 * 3600, 5.0, 2);
  const v = computeVerdict(a, b, { minMpptHours: 6 });
  assertEquals(v.label, "MIXED");
});

function stub(mpptSeconds: number, kwh: number, stalls: number): CurveMetrics {
  return {
    window: { tsFrom: 0, tsTo: mpptSeconds, sampleCount: mpptSeconds, mpptSampleCount: mpptSeconds },
    energy: { kwh, peakW: 0, meanWInMppt: 0 },
    envelope: [],
    curveFit: { binsAboveCurve: 0, binsBelowCurve: 0, rmseW: 0 },
    stalls: { count: stalls, hotspots: [] },
    recommendation: null,
  };
}
