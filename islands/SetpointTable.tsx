import { useEffect, useState } from "preact/hooks";
import type { Curve } from "../lib/types.ts";

interface Metrics {
  envelope: { voltage: number; pP90: number; confidence: number; sampleCount: number }[];
  recommendation: { voltage: number; power: number }[] | null;
  stalls: { hotspots: { vBand: [number, number]; count: number }[] };
}

function envelopeAt(env: Metrics["envelope"], v: number): { p: number; n: number; conf: number } | null {
  // Find closest bin
  let best: typeof env[number] | null = null;
  for (const b of env) {
    if (best == null || Math.abs(b.voltage - v) < Math.abs(best.voltage - v)) best = b;
  }
  if (!best) return null;
  return { p: best.pP90, n: best.sampleCount, conf: best.confidence };
}

function inHotspot(v: number, hotspots: Metrics["stalls"]["hotspots"]): boolean {
  return hotspots.some((h) => v >= h.vBand[0] && v < h.vBand[1]);
}

export default function SetpointTable({ curve }: { curve: Curve | null }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    if (!curve) return;
    const now = Math.floor(Date.now() / 1000);
    const from = now - 7 * 86400;
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curveId: curve.id, tsFrom: from, tsTo: now }),
    }).then((r) => r.json()).then(setMetrics);
  }, [curve?.id]);

  if (!curve) return <div>No active curve</div>;

  return (
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
      <thead>
        <tr style="text-align:left;border-bottom:1px solid var(--border);">
          <th>V</th>
          <th>Current W</th>
          <th>Envelope p90</th>
          <th>Suggested</th>
          <th>Δ</th>
          <th>Confidence</th>
          <th>Hotspot</th>
        </tr>
      </thead>
      <tbody>
        {curve.points.map((pt) => {
          const env = metrics ? envelopeAt(metrics.envelope, pt.voltage) : null;
          const sug = metrics?.recommendation?.find((r) => r.voltage === pt.voltage);
          const hot = metrics ? inHotspot(pt.voltage, metrics.stalls.hotspots) : false;
          const delta = sug ? sug.power - pt.power : null;
          return (
            <tr key={pt.voltage} style="border-bottom:1px solid #23262d;">
              <td>{pt.voltage}</td>
              <td>{pt.power}</td>
              <td>{env ? Math.round(env.p) : "—"}</td>
              <td>{sug ? sug.power : "—"}</td>
              <td style={delta != null && delta !== 0 ? `color:${delta > 0 ? "#7ee07e" : "#ff9c9c"}` : ""}>
                {delta != null ? (delta > 0 ? `+${delta}` : delta) : "—"}
              </td>
              <td class="muted">{env ? `n=${env.n} (${(env.conf * 100).toFixed(0)}%)` : "—"}</td>
              <td>{hot ? "⚠" : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
