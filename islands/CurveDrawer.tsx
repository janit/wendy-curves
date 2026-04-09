import { useEffect, useState } from "preact/hooks";
import type { Curve, CurvePoint } from "../lib/types.ts";

function parsePastedPoints(text: string): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const m = cleaned.split(/[\s,;\t]+/);
    if (m.length < 2) continue;
    const v = parseFloat(m[0]);
    const w = parseFloat(m[1]);
    if (Number.isFinite(v) && Number.isFinite(w)) out.push({ voltage: v, power: w });
  }
  return out;
}

export default function CurveDrawer() {
  const [open, setOpen] = useState(false);
  const [curves, setCurves] = useState<Curve[]>([]);
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    fetch("/api/curves").then((r) => r.json()).then(setCurves);

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const create = async () => {
    setError(null);
    const points = parsePastedPoints(paste);
    if (!name || points.length === 0) {
      setError("Need a name and at least one V W line");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/curves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, notes, source: "manual", points }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "create failed");
      return;
    }
    setName(""); setNotes(""); setPaste("");
    refresh();
  };

  const activate = async (id: number) => {
    setBusy(true);
    await fetch(`/api/curves/${id}/activate`, { method: "POST", body: "{}" });
    setBusy(false);
    location.reload();  // simplest way to refresh the active curve banner
  };

  return (
    <>
      <button class="drawer-toggle" onClick={() => setOpen(true)}>+ curve</button>
      {open && (
        <div class="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside class="drawer" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>Curves</strong>
              <button onClick={() => setOpen(false)}>×</button>
            </header>

            <section>
              <h3>Create new</h3>
              <input
                placeholder="curve name (e.g. manual-2026-04-08-evening)"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
              <textarea
                placeholder="Paste 16 lines: 'voltage  watts' per line"
                rows={10}
                value={paste}
                onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
              />
              <input
                placeholder="notes (optional)"
                value={notes}
                onInput={(e) => setNotes((e.target as HTMLInputElement).value)}
              />
              <button onClick={create} disabled={busy}>Create</button>
              {error && <div class="error">{error}</div>}
            </section>

            <section>
              <h3>All curves</h3>
              <ul class="curve-list">
                {curves.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <span class="muted"> · {c.source} · {c.points.length} points</span>
                    <button onClick={() => activate(c.id)} disabled={busy}>Activate</button>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
