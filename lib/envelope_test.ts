import { assertEquals, assertAlmostEquals } from "@std/assert";
import { binSamples, envelopeFromSamples } from "./envelope.ts";
import type { Sample } from "./types.ts";

function s(ts: number, v: number, p: number, charge = "mppt"): Sample {
  return {
    ts, arrayVoltage: v, arrayCurrent: null, tristarPower: p,
    batteryVoltage: null, chargeState: charge, victron48vPower: null,
    victron24vPower: null, mode: null,
  };
}

Deno.test("binSamples groups into 0.5V bins", () => {
  const samples = [
    s(1, 100.0, 200), s(2, 100.1, 210), s(3, 100.4, 220),
    s(4, 100.5, 240), s(5, 100.7, 250),
  ];
  const bins = binSamples(samples, 0.5);
  assertEquals(bins.size, 2);
  assertEquals(bins.get(100.0)!.length, 3);
  assertEquals(bins.get(100.5)!.length, 2);
});

Deno.test("envelopeFromSamples drops non-mppt and below-49V samples", () => {
  const samples = [
    s(1, 100, 200, "mppt"),
    s(2, 100, 210, "absorption"),  // dropped
    s(3, 30, 50, "mppt"),          // below threshold, dropped
    s(4, 100, 220, "mppt"),
  ];
  const env = envelopeFromSamples(samples, { binWidth: 0.5, minVoltage: 49.5 });
  assertEquals(env.length, 1);
  assertEquals(env[0].sampleCount, 2);
});

Deno.test("envelopeFromSamples computes p90", () => {
  // 10 samples in one bin, powers 100..1000 in steps of 100
  const samples: Sample[] = [];
  for (let i = 0; i < 10; i++) {
    samples.push(s(i, 100, (i + 1) * 100));
  }
  const env = envelopeFromSamples(samples, { binWidth: 0.5, minVoltage: 49.5 });
  assertEquals(env.length, 1);
  // p90 of [100,200,...,1000] using nearest-rank ≈ 1000 (index 9)
  // using the linear interpolation formula it's 910
  assertAlmostEquals(env[0].pP90, 910, 1);
});

Deno.test("envelopeFromSamples confidence saturates with sample count", () => {
  const few: Sample[] = [s(1, 100, 200), s(2, 100, 210)];
  const many: Sample[] = [];
  for (let i = 0; i < 200; i++) many.push(s(i, 100, 200 + i));
  const cFew = envelopeFromSamples(few, { binWidth: 0.5, minVoltage: 49.5 })[0].confidence;
  const cMany = envelopeFromSamples(many, { binWidth: 0.5, minVoltage: 49.5 })[0].confidence;
  assertEquals(cFew < 0.1, true);
  assertEquals(cMany > 0.99, true);
});
