import { useEffect, useState } from "preact/hooks";

interface Snapshot {
  wendyConnected: boolean;
  lastEvent: { ts: number; state: { arrayVoltage?: number; tristarPower?: number; chargeState?: string } } | null;
  db: { sampleCount: number; oldestTs: number | null; newestTs: number };
}

export default function LiveFooter(initial: {
  initialConnected: boolean;
  initialEvent: { ts: number; state: unknown } | null;
  newestTs: number;
  oldestTs: number | null;
}) {
  const [snap, setSnap] = useState<Snapshot>({
    wendyConnected: initial.initialConnected,
    lastEvent: initial.initialEvent as Snapshot["lastEvent"],
    db: { sampleCount: 0, oldestTs: initial.oldestTs, newestTs: initial.newestTs },
  });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await fetch("/api/snapshot").then((r) => r.json());
        if (!cancelled) setSnap(j);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const ev = snap.lastEvent?.state;
  return (
    <div class="live-status">
      <span>
        <span class={`dot ${snap.wendyConnected ? "live" : "dead"}`} />
        {snap.wendyConnected ? "connected" : "disconnected"}
      </span>
      {ev && (
        <span class="live-reading">
          {ev.arrayVoltage != null && <>{ev.arrayVoltage.toFixed(1)} V · </>}
          {ev.tristarPower != null && <>{Math.round(ev.tristarPower)} W · </>}
          {ev.chargeState ?? "—"}
        </span>
      )}
      <span class="muted">
        {snap.db.sampleCount.toLocaleString()} samples
        {snap.db.oldestTs != null && <> · oldest {new Date(snap.db.oldestTs * 1000).toLocaleDateString()}</>}
      </span>
    </div>
  );
}
