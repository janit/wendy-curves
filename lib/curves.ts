import { Database } from "@db/sqlite";
import type { Curve, CurvePoint } from "./types.ts";

interface CreateCurveInput {
  name: string;
  notes: string | null;
  source: "manual" | "suggested" | "imported";
  points: CurvePoint[];
}

export function createCurve(db: Database, input: CreateCurveInput): number {
  const ts = Math.floor(Date.now() / 1000);
  db.exec("BEGIN");
  let stmt: ReturnType<Database["prepare"]> | null = null;
  try {
    db.prepare(
      "INSERT INTO curves (name, notes, created_ts, source) VALUES (?, ?, ?, ?)",
    ).run(input.name, input.notes, ts, input.source);
    const id = Number(db.prepare("SELECT last_insert_rowid() as id").get<{ id: number }>()!.id);

    stmt = db.prepare(
      "INSERT INTO curve_points (curve_id, voltage, power) VALUES (?, ?, ?)",
    );
    for (const p of input.points) {
      stmt.run(id, p.voltage, p.power);
    }
    db.exec("COMMIT");
    return id;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    if (stmt) stmt.finalize();
  }
}

export function getCurve(db: Database, id: number): Curve | null {
  const row = db.prepare(
    "SELECT id, name, notes, created_ts, source FROM curves WHERE id = ?",
  ).get<{
    id: number; name: string; notes: string | null; created_ts: number; source: string;
  }>(id);
  if (!row) return null;
  const points = db.prepare(
    "SELECT voltage, power FROM curve_points WHERE curve_id = ? ORDER BY voltage",
  ).all<CurvePoint>(id);
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    createdTs: row.created_ts,
    source: row.source as Curve["source"],
    points,
  };
}

export function listCurves(db: Database): Curve[] {
  const rows = db.prepare(
    "SELECT id FROM curves ORDER BY created_ts DESC, id DESC",
  ).all<{ id: number }>();
  return rows.map((r) => getCurve(db, r.id)).filter((c): c is Curve => c !== null);
}

export function updateCurveNotes(db: Database, id: number, notes: string | null): void {
  db.prepare("UPDATE curves SET notes = ? WHERE id = ?").run(notes, id);
}

export function deleteCurve(db: Database, id: number): void {
  db.prepare("DELETE FROM curves WHERE id = ?").run(id);
}
