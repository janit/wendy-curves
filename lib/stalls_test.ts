import { assertEquals } from "@std/assert";
import { detectStalls, clusterStallHotspots } from "./stalls.ts";
import type { Sample } from "./types.ts";
import type { CurvePoint } from "./types.ts";

function s(ts: number, v: number, p: number): Sample {
  return {
    ts, arrayVoltage: v, arrayCurrent: null, tristarPower: p,
    batteryVoltage: null, chargeState: "mppt", victron48vPower: null,
    victron24vPower: null, mode: null,
  };
}

const CURVE: CurvePoint[] = [
  { voltage: 49.5, power: 2 },
  { voltage: 100, power: 250 },
  { voltage: 110, power: 600 },
  { voltage: 120, power: 1500 },
  { voltage: 140, power: 5000 },
];

Deno.test("detectStalls finds an obvious voltage collapse under load", () => {
  const samples: Sample[] = [];
  // Steady at 110V, ~600W for 20 sec
  for (let t = 0; t < 20; t++) samples.push(s(t, 110, 600));
  // Voltage collapses to 95V at t=20 (15V drop in 10s window)
  samples.push(s(21, 95, 100));
  const stalls = detectStalls(samples, CURVE, {
    windowSeconds: 10,
    voltageDropV: 8,
    powerFractionOfCurve: 0.7,
    minVoltage: 50,
  });
  assertEquals(stalls.length, 1);
  assertEquals(stalls[0].vCollapseFrom, 110);
  assertEquals(stalls[0].vCollapseTo, 95);
});

Deno.test("detectStalls ignores night spin-down (voltage already low)", () => {
  const samples: Sample[] = [];
  for (let t = 0; t < 20; t++) samples.push(s(t, 48, 0));
  samples.push(s(21, 30, 0));
  const stalls = detectStalls(samples, CURVE, {
    windowSeconds: 10,
    voltageDropV: 8,
    powerFractionOfCurve: 0.7,
    minVoltage: 50,
  });
  assertEquals(stalls.length, 0);
});

Deno.test("detectStalls ignores collapses with no load demand", () => {
  const samples: Sample[] = [];
  // 110V but power was only 50W (< 0.7 × 600)
  for (let t = 0; t < 20; t++) samples.push(s(t, 110, 50));
  samples.push(s(21, 95, 0));
  const stalls = detectStalls(samples, CURVE, {
    windowSeconds: 10,
    voltageDropV: 8,
    powerFractionOfCurve: 0.7,
    minVoltage: 50,
  });
  assertEquals(stalls.length, 0);
});

Deno.test("clusterStallHotspots groups by voltage band", () => {
  const stalls = [
    { tsStart: 1, tsEnd: 2, vCollapseFrom: 110, vCollapseTo: 95, pAtStart: 600 },
    { tsStart: 100, tsEnd: 101, vCollapseFrom: 112, vCollapseTo: 90, pAtStart: 700 },
    { tsStart: 200, tsEnd: 201, vCollapseFrom: 130, vCollapseTo: 105, pAtStart: 3000 },
  ];
  const hotspots = clusterStallHotspots(stalls, 5);
  // Two hotspots: 110-115 (×2) and 130-135 (×1)
  assertEquals(hotspots.length, 2);
  assertEquals(hotspots[0].count, 2);
  assertEquals(hotspots[0].vBand[0], 110);
});
