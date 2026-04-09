import { assertEquals, assertExists } from "@std/assert";
import { openDb } from "./db.ts";
import { listCurves } from "./curves.ts";
import { currentActivation } from "./activations.ts";
import { seedIfEmpty, SCREENSHOT_CURVE_NAME } from "./seed.ts";

Deno.test("seedIfEmpty inserts the screenshot curve and opens activation", () => {
  const db = openDb(":memory:");
  seedIfEmpty(db, 100);
  const curves = listCurves(db);
  assertEquals(curves.length, 1);
  assertEquals(curves[0].name, SCREENSHOT_CURVE_NAME);
  assertEquals(curves[0].source, "imported");
  // First setpoint matches screenshot
  assertEquals(curves[0].points[0].voltage, 49.5);
  assertEquals(curves[0].points[0].power, 2);
  // Last setpoint matches screenshot
  const last = curves[0].points[curves[0].points.length - 1];
  assertEquals(last.voltage, 140);
  assertEquals(last.power, 5000);
  // Activation opened
  const act = currentActivation(db);
  assertExists(act);
  assertEquals(act.curveId, curves[0].id);
  assertEquals(act.tsFrom, 100);
  db.close();
});

Deno.test("seedIfEmpty is a no-op when curves already exist", () => {
  const db = openDb(":memory:");
  seedIfEmpty(db, 100);
  seedIfEmpty(db, 200);
  assertEquals(listCurves(db).length, 1);
  db.close();
});
