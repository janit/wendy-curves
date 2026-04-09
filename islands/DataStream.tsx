import { useEffect, useRef, useState } from "preact/hooks";
import type { Sample } from "../lib/types.ts";

const POLL_MS = 1000;
const ROW_COUNT = 100;

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function fmtNum(v: number | null, digits = 1): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function chargeStateClass(s: string | null): string {
  if (!s) return "ds-cs-unknown";
  if (s.startsWith("mppt")) return "ds-cs-mppt";
  if (s.startsWith("absorption")) return "ds-cs-absorption";
  if (s.startsWith("float")) return "ds-cs-float";
  if (s.startsWith("fault")) return "ds-cs-fault";
  if (s === "night") return "ds-cs-night";
  return "ds-cs-unknown";
}

export default function DataStream() {
  const [rows, setRows] = useState<Sample[]>([]);
  const [connected, setConnected] = useState(true);
  const [lastFetchTs, setLastFetchTs] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tail?n=${ROW_COUNT}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const j = await res.json() as { rows: Sample[] };
        if (!cancelled) {
          setRows(j.rows);
          setConnected(true);
          setLastFetchTs(Math.floor(Date.now() / 1000));
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    tick();
    timerRef.current = setInterval(tick, POLL_MS) as unknown as number;
    return () => {
      cancelled = true;
      if (timerRef.current != null) clearInterval(timerRef.current);
    };
  }, []);

  const newestTs = rows[0]?.ts ?? null;
  const lag = newestTs != null && lastFetchTs != null ? lastFetchTs - newestTs : null;

  return (
    <div class="data-stream">
      <div class="data-stream-header">
        <span class={`dot ${connected ? "live" : "dead"}`} />
        <span>{connected ? "polling 1s" : "disconnected"}</span>
        <span class="muted">·</span>
        <span class="muted">{rows.length} rows</span>
        {lag != null && (
          <>
            <span class="muted">·</span>
            <span class={lag > 3 ? "ds-lag-warn" : "muted"}>
              newest {lag}s ago
            </span>
          </>
        )}
      </div>
      <table class="data-stream-table">
        <thead>
          <tr>
            <th>Time</th>
            <th class="num">Array V</th>
            <th class="num">Array A</th>
            <th class="num">TriStar W</th>
            <th class="num">48V batt V</th>
            <th class="num">24V batt V</th>
            <th>State</th>
            <th class="num">48V shunt W</th>
            <th class="num">24V shunt W</th>
            <th class="num">Total W</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={11} class="muted" style="text-align:center;padding:1rem;">
                No samples yet — waiting for SSE events…
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const totalW = (r.victron48vPower ?? 0) + (r.victron24vPower ?? 0);
            const hasTotal = r.victron48vPower != null || r.victron24vPower != null;
            // 24V shunt is expected to go slightly negative in 48V mode (relay coil draw).
            // Only flag as "warn" if the TOTAL is negative — that means the whole system
            // is net-draining, which is the actual problem worth noticing (e.g. parasitic zone).
            const totalNegative = hasTotal && totalW < 0;
            return (
              <tr key={r.ts}>
                <td class="ds-time">{fmtTime(r.ts)}</td>
                <td class="num">{fmtNum(r.arrayVoltage)}</td>
                <td class="num">{fmtNum(r.arrayCurrent, 2)}</td>
                <td class="num">{fmtNum(r.tristarPower, 0)}</td>
                <td class="num">{fmtNum(r.batteryVoltage)}</td>
                <td class="num">{fmtNum(r.victron24vVoltage, 2)}</td>
                <td><span class={chargeStateClass(r.chargeState)}>{r.chargeState ?? "—"}</span></td>
                <td class="num">{fmtNum(r.victron48vPower, 0)}</td>
                <td class="num muted">{fmtNum(r.victron24vPower, 0)}</td>
                <td class={`num${totalNegative ? " ds-negative" : ""}`}>
                  <strong>{hasTotal ? fmtNum(totalW, 0) : "—"}</strong>
                </td>
                <td class="muted">{r.mode ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
