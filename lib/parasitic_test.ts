import { assertEquals } from "@std/assert";
import { computeParasitic } from "./parasitic.ts";
import type { Sample } from "./types.ts";

function s(ts: number, v: number, shunt: number | null, charge = "mppt"): Sample {
  return {
    ts, arrayVoltage: v, arrayCurrent: null, tristarPower: null,
    batteryVoltage: null, chargeState: charge, victron48vPower: shunt,
    victron24vPower: null, mode: null,
  };
}

Deno.test("computeParasitic returns null ceiling on empty samples", () => {
  const r = computeParasitic([]);
  assertEquals(r.ceilingV, null);
  assertEquals(r.totalDrainWh, 0);
  assertEquals(r.byBin.length, 0);
});

Deno.test("computeParasitic returns null when all shunt readings are non-negative", () => {
  const samples: Sample[] = [];
  for (let i = 0; i < 100; i++) samples.push(s(i, 60, 5));  // all productive
  const r = computeParasitic(samples);
  assertEquals(r.ceilingV, null);
  assertEquals(r.totalDrainWh, 0);
});

Deno.test("computeParasitic identifies a clear parasitic zone", () => {
  const samples: Sample[] = [];
  // 50V: 20 parasitic samples at -8W each
  for (let i = 0; i < 20; i++) samples.push(s(i, 50, -8));
  // 60V: 20 productive samples at +10W each
  for (let i = 20; i < 40; i++) samples.push(s(i, 60, 10));
  const r = computeParasitic(samples);
  assertEquals(r.ceilingV, 51); // upper edge of the 50V bin (binWidth=1)
  // 20 samples × 8W / 3600 = 0.0444 Wh
  assertEquals(Math.round(r.totalDrainWh * 10000), 444);
});

Deno.test("computeParasitic picks the highest qualifying bin", () => {
  const samples: Sample[] = [];
  // 48V: 20 parasitic (100%)
  for (let i = 0; i < 20; i++) samples.push(s(i, 48, -5));
  // 50V: 20 parasitic (100%)
  for (let i = 20; i < 40; i++) samples.push(s(i, 50, -5));
  // 52V: 20 parasitic (100%)
  for (let i = 40; i < 60; i++) samples.push(s(i, 52, -5));
  // 54V: 20 productive (0%)
  for (let i = 60; i < 80; i++) samples.push(s(i, 54, 5));
  const r = computeParasitic(samples);
  assertEquals(r.ceilingV, 53); // upper edge of 52V bin
});

Deno.test("computeParasitic ignores bins with fewer than minSamples", () => {
  const samples: Sample[] = [];
  // 50V: 10 parasitic
  for (let i = 0; i < 10; i++) samples.push(s(i, 50, -5));
  // 55V: 2 parasitic (below default minSamples=3) — should be ignored
  for (let i = 10; i < 12; i++) samples.push(s(i, 55, -5));
  const r = computeParasitic(samples);
  assertEquals(r.ceilingV, 51); // 50V bin qualified, 55V bin too few samples
});

Deno.test("computeParasitic ignores non-MPPT samples", () => {
  const samples: Sample[] = [];
  for (let i = 0; i < 20; i++) samples.push(s(i, 50, -8, "absorption"));  // not mppt
  const r = computeParasitic(samples);
  assertEquals(r.ceilingV, null);
});
