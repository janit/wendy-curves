import { Database } from "@db/sqlite";
import type { Activation } from "./types.ts";

function rowToActivation(r: {
  id: number; curve_id: number; ts_from: number; ts_to: number | null; note: string | null;
}): Activation {
  return {
    id: r.id,
    curveId: r.curve_id,
    tsFrom: r.ts_from,
    tsTo: r.ts_to,
    note: r.note,
  };
}

export function activateCurve(
  db: Database,
  curveId: number,
  ts: number,
  note: string | null,
): number {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE curve_activations SET ts_to = ? WHERE ts_to IS NULL").run(ts);
    db.prepare(
      "INSERT INTO curve_activations (curve_id, ts_from, ts_to, note) VALUES (?, ?, NULL, ?)",
    ).run(curveId, ts, note);
    const id = Number(
      db.prepare("SELECT last_insert_rowid() as id").get<{ id: number }>()!.id,
    );
    db.exec("COMMIT");
    return id;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function currentActivation(db: Database): Activation | null {
  const r = db.prepare(
    "SELECT id, curve_id, ts_from, ts_to, note FROM curve_activations WHERE ts_to IS NULL",
  ).get<{ id: number; curve_id: number; ts_from: number; ts_to: number | null; note: string | null }>();
  return r ? rowToActivation(r) : null;
}

export function listActivations(db: Database): Activation[] {
  const rows = db.prepare(
    "SELECT id, curve_id, ts_from, ts_to, note FROM curve_activations ORDER BY ts_from",
  ).all<{ id: number; curve_id: number; ts_from: number; ts_to: number | null; note: string | null }>();
  return rows.map(rowToActivation);
}

export function activationsForCurve(db: Database, curveId: number): Activation[] {
  const rows = db.prepare(
    "SELECT id, curve_id, ts_from, ts_to, note FROM curve_activations WHERE curve_id = ? ORDER BY ts_from",
  ).all<{ id: number; curve_id: number; ts_from: number; ts_to: number | null; note: string | null }>(curveId);
  return rows.map(rowToActivation);
}

export function deleteCurveBlocked(db: Database, curveId: number): void {
  const r = db.prepare(
    "SELECT COUNT(*) as n FROM curve_activations WHERE curve_id = ?",
  ).get<{ n: number }>(curveId);
  if ((r?.n ?? 0) > 0) {
    throw new Error(`cannot delete curve ${curveId}: has activation history`);
  }
  db.prepare("DELETE FROM curves WHERE id = ?").run(curveId);
}
