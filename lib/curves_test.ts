import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { openDb } from "./db.ts";
import {
  createCurve, getCurve, listCurves, updateCurveNotes, deleteCurve,
} from "./curves.ts";

const POINTS = [
  { voltage: 49.5, power: 2 },
  { voltage: 60, power: 10 },
  { voltage: 90, power: 100 },
  { voltage: 140, power: 5000 },
];

Deno.test("createCurve + getCurve round trip", () => {
  const db = openDb(":memory:");
  const id = createCurve(db, { name: "test-curve", notes: "hello", source: "manual", points: POINTS });
  const c = getCurve(db, id);
  assertExists(c);
  assertEquals(c.name, "test-curve");
  assertEquals(c.notes, "hello");
  assertEquals(c.source, "manual");
  assertEquals(c.points.length, 4);
  assertEquals(c.points[0].voltage, 49.5);
  db.close();
});

Deno.test("listCurves returns curves ordered by created_ts desc", () => {
  const db = openDb(":memory:");
  createCurve(db, { name: "a", notes: null, source: "manual", points: POINTS });
  createCurve(db, { name: "b", notes: null, source: "manual", points: POINTS });
  const list = listCurves(db);
  assertEquals(list.length, 2);
  // b created last → first in list
  assertEquals(list[0].name, "b");
  db.close();
});

Deno.test("createCurve refuses duplicate name", () => {
  const db = openDb(":memory:");
  createCurve(db, { name: "dup", notes: null, source: "manual", points: POINTS });
  assertThrows(
    () => createCurve(db, { name: "dup", notes: null, source: "manual", points: POINTS }),
  );
  db.close();
});

Deno.test("updateCurveNotes only changes notes", () => {
  const db = openDb(":memory:");
  const id = createCurve(db, { name: "n", notes: "old", source: "manual", points: POINTS });
  updateCurveNotes(db, id, "new");
  assertEquals(getCurve(db, id)?.notes, "new");
  db.close();
});

Deno.test("deleteCurve cascades to points", () => {
  const db = openDb(":memory:");
  const id = createCurve(db, { name: "del", notes: null, source: "manual", points: POINTS });
  deleteCurve(db, id);
  assertEquals(getCurve(db, id), null);
  const remaining = db.prepare("SELECT COUNT(*) as n FROM curve_points WHERE curve_id = ?")
    .get<{ n: number }>(id);
  assertEquals(remaining?.n, 0);
  db.close();
});
