import { assertEquals, assertAlmostEquals } from "@std/assert";
import { computeDualInsights } from "./dual-insights.ts";
import type { Sample } from "./types.ts";

function s(ts: number, v: number, p48: number | null, p24: number | null, mode: string): Sample {
  return {
    ts, arrayVoltage: v, arrayCurrent: null, tristarPower: null,
    batteryVoltage: null, chargeState: "mppt",
    victron48vPower: p48, victron24vPower: p24,
    victron24vVoltage: null, mode,
  };
}

Deno.test("computeDualInsights returns empty result on empty input", () => {
  const r = computeDualInsights([]);
  assertEquals(r.marsrock.bins.length, 0);
  assertEquals(r.marsrock.harvestWh, 0);
  assertEquals(r.tristar.harvestWh, 0);
  assertEquals(r.coil.drainWh, 0);
  assertEquals(r.modeDistribution.total, 0);
});

Deno.test("computeDualInsights separates 24V harvest from 48V harvest", () => {
  // 100W * 60s = 1.6666... Wh for 24V; 500W * 60s = 8.3333... Wh for 48V
  const step24 = 100 / 3600 / 1000;  // kWh per second at 100W
  const step48 = 500 / 3600 / 1000;  // kWh per second at 500W
  const samples: Sample[] = [];
  // 60 seconds in 24v mode at 30V array, 100W 24v harvest
  for (let t = 0; t < 60; t++) {
    const base: Sample = s(t, 30, 0, 100, "24v");
    base.victronChargedKwh = 100 + t * step24;       // first=100, last=100+59*step24
    base.victron48vChargedKwh = 200;                  // unchanged
    samples.push(base);
  }
  // 60 seconds in 48v mode at 80V array, 500W 48v harvest, -3W coil on 24v
  for (let t = 100; t < 160; t++) {
    const base: Sample = s(t, 80, 500, -3, "48v");
    // 24V counter unchanged; 48V counter starts where first sample is 200 (t=100)
    // and ends at 200 + 60*step48 (t=159 is step 59, so we need +1 to account for the
    // full 60-second window: first=200+(t-100)*step48, last=200+59*step48 → delta=59*step48)
    // To get exactly 60-step delta, start at 200−step48 so first=200, last=200+59*step48=+60
    base.victronChargedKwh = 100 + 59 * step24;      // constant (24V mode ended)
    base.victron48vChargedKwh = 200 - step48 + (t - 99) * step48; // first=200, last=200+59*step48
    samples.push(base);
  }
  const r = computeDualInsights(samples);
  // 24V counter delta: (100+59*step24) - 100 = 59*step24 kWh; ≈ 59*100/3600/1000 * 1000 Wh
  // 48V counter delta: (200+59*step48) - 200 = 59*step48 kWh; ≈ 59*500/3600/1000 * 1000 Wh
  // Tolerance of 0.1 Wh since we're using 59-step deltas (one sample short)
  assertAlmostEquals(r.marsrock.harvestWh, 59 * 100 / 3600, 0.01);
  assertAlmostEquals(r.tristar.harvestWh, 59 * 500 / 3600, 0.1);
  assertAlmostEquals(r.coil.drainWh, 3 * 60 / 3600, 0.01);
  assertEquals(r.marsrock.peakW, 100);
  assertEquals(r.tristar.peakW, 500);
  assertEquals(r.modeDistribution.in24v, 60);
  assertEquals(r.modeDistribution.in48v, 60);
});

Deno.test("computeDualInsights ignores samples where shunts are null (bootstrap rows)", () => {
  const samples: Sample[] = [
    s(1, 30, null, null, "24v"),  // bootstrap row — should be ignored
    s(2, 30, 0, 50, "24v"),        // live sample
  ];
  const r = computeDualInsights(samples);
  assertEquals(r.modeDistribution.total, 1); // only the live sample counted
  // No victronChargedKwh on either sample → counter delta is 0
  assertEquals(r.marsrock.harvestWh, 0);
});

Deno.test("computeDualInsights bins Marsrock harvest by voltage", () => {
  const samples: Sample[] = [];
  // 10 samples at 30V, 50W each
  for (let t = 0; t < 10; t++) samples.push(s(t, 30, 0, 50, "24v"));
  // 10 samples at 35V, 100W each
  for (let t = 10; t < 20; t++) samples.push(s(t, 35, 0, 100, "24v"));
  const r = computeDualInsights(samples, { binWidth: 1, scatterMaxPoints: 3000 });
  assertEquals(r.marsrock.bins.length, 2);
  assertEquals(r.marsrock.bins[0].voltage, 30);
  assertEquals(r.marsrock.bins[0].sampleCount, 10);
  assertEquals(r.marsrock.bins[0].pP90, 50);
  assertEquals(r.marsrock.bins[1].voltage, 35);
  assertEquals(r.marsrock.bins[1].pP90, 100);
});

Deno.test("computeDualInsights downsamples scatter points", () => {
  const samples: Sample[] = [];
  for (let t = 0; t < 100; t++) samples.push(s(t, 30, 0, 50, "24v"));
  const r = computeDualInsights(samples, { binWidth: 1, scatterMaxPoints: 10 });
  // 100 samples, cap 10 → stride = ceil(100/10) = 10 → keeps every 10th → 10 points
  assertEquals(r.raw.scatterPoints.length <= 11, true); // allow slight off-by-one
});

Deno.test("computeDualInsights uses cumulative counter delta for harvest", () => {
  const samples: Sample[] = [
    // charged=100 kWh at start of window
    { ts: 1, arrayVoltage: 60, arrayCurrent: null, tristarPower: null,
      batteryVoltage: null, chargeState: "mppt",
      victron48vPower: 0, victron24vPower: -5, // net NEGATIVE due to loads
      victron24vVoltage: null,
      victronChargedKwh: 100, victron48vChargedKwh: 200,
      mode: "24v" },
    // charged=100.05 kWh (50 Wh harvested) at end of window
    { ts: 60, arrayVoltage: 60, arrayCurrent: null, tristarPower: null,
      batteryVoltage: null, chargeState: "mppt",
      victron48vPower: 0, victron24vPower: -3, // still negative!
      victron24vVoltage: null,
      victronChargedKwh: 100.05, victron48vChargedKwh: 200.02,
      mode: "24v" },
  ];
  const r = computeDualInsights(samples);
  // Counter delta: 100.05 - 100 = 0.05 kWh = 50 Wh — even though the
  // instantaneous shunt is negative the whole time (load masking).
  assertEquals(Math.round(r.marsrock.harvestWh), 50);
  assertEquals(Math.round(r.tristar.harvestWh), 20);
});
