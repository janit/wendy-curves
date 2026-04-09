import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { openDb } from "./db.ts";
import { createCurve } from "./curves.ts";
import {
  activateCurve, currentActivation, listActivations, activationsForCurve, deleteCurveBlocked,
} from "./activations.ts";

const POINTS = [{ voltage: 49.5, power: 2 }, { voltage: 140, power: 5000 }];

function freshDbWithCurves(): { db: ReturnType<typeof openDb>; idA: number; idB: number } {
  const db = openDb(":memory:");
  const idA = createCurve(db, { name: "a", notes: null, source: "manual", points: POINTS });
  const idB = createCurve(db, { name: "b", notes: null, source: "manual", points: POINTS });
  return { db, idA, idB };
}

Deno.test("activateCurve opens an activation row when none exists", () => {
  const { db, idA } = freshDbWithCurves();
  const id = activateCurve(db, idA, 1000, "first");
  const cur = currentActivation(db);
  assertExists(cur);
  assertEquals(cur.curveId, idA);
  assertEquals(cur.tsTo, null);
  assertEquals(cur.note, "first");
  assertEquals(cur.id, id);
  db.close();
});

Deno.test("activating a second curve closes the first atomically", () => {
  const { db, idA, idB } = freshDbWithCurves();
  activateCurve(db, idA, 1000, null);
  activateCurve(db, idB, 2000, null);
  const cur = currentActivation(db);
  assertExists(cur);
  assertEquals(cur.curveId, idB);
  const all = listActivations(db);
  assertEquals(all.length, 2);
  const aRow = all.find((r) => r.curveId === idA);
  assertExists(aRow);
  assertEquals(aRow.tsTo, 2000);
  db.close();
});

Deno.test("activationsForCurve returns all activations of one curve", () => {
  const { db, idA, idB } = freshDbWithCurves();
  activateCurve(db, idA, 1000, null);
  activateCurve(db, idB, 2000, null);
  activateCurve(db, idA, 3000, null);
  const aRows = activationsForCurve(db, idA);
  assertEquals(aRows.length, 2);
  db.close();
});

Deno.test("only one open activation row exists at a time", () => {
  const { db, idA, idB } = freshDbWithCurves();
  activateCurve(db, idA, 1000, null);
  activateCurve(db, idB, 2000, null);
  const open = db.prepare(
    "SELECT COUNT(*) as n FROM curve_activations WHERE ts_to IS NULL",
  ).get<{ n: number }>();
  assertEquals(open?.n, 1);
  db.close();
});

Deno.test("deleteCurveBlocked refuses to delete a curve with activations", () => {
  const { db, idA } = freshDbWithCurves();
  activateCurve(db, idA, 1000, null);
  assertThrows(() => deleteCurveBlocked(db, idA));
  db.close();
});
