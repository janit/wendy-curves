import { useEffect, useState } from "preact/hooks";

interface CurvePoint {
  voltage: number;
  power: number;
}

interface RecommendFreeResponse {
  recommendation: CurvePoint[];
  pointCount: number;
  parasitic: {
    ceilingV: number | null;
    totalDrainWh: number;
  };
}

function classify(
  voltage: number,
  parasiticCeilingV: number | null,
  observedMaxV: number,
): "floor" | "observed" | "extrapolated" {
  if (parasiticCeilingV != null && voltage <= parasiticCeilingV) return "floor";
  if (voltage <= observedMaxV) return "observed";
  return "extrapolated";
}

function zoneClass(z: "floor" | "observed" | "extrapolated"): string {
  if (z === "floor") return "zone-floor";
  if (z === "observed") return "zone-observed";
  return "zone-extrapolated";
}

function zoneLabel(z: "floor" | "observed" | "extrapolated"): string {
  if (z === "floor") return "floor";
  if (z === "observed") return "observed";
  return "extrapolated";
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export default function FreeVoltageTable() {
  const [data, setData] = useState<RecommendFreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/recommend-free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = await res.json();
      setData(j);
      setLastFetch(new Date());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copyToClipboard = async () => {
    if (!data) return;
    const text = data.recommendation
      .map((p) => `${p.voltage} ${p.power}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  if (error) return <div class="muted">Failed to load: {error}</div>;
  if (!data) return <div class="muted">Loading…</div>;

  // Observed range comes from the non-zero entries that aren't extrapolated.
  // We don't have the raw envelope here, so approximate by: the highest
  // voltage whose power is "not extrapolated-shaped" — easiest heuristic
  // is the voltage where the ramp starts to flatten. Simpler: derive from
  // the recommendation itself by finding the last point below ~300W.
  // This is imperfect but good enough for the table's "zone" column.
  // If the free algorithm has full data, this will cover most of the range.
  const firstNonZero = data.recommendation.find((p) => p.power > 0);
  const lastBelow300W = [...data.recommendation].reverse().find((p) => p.power < 300);
  const observedMaxV = lastBelow300W?.voltage ?? (firstNonZero?.voltage ?? 0);

  return (
    <div class="free-voltage-table">
      <div class="fvt-header">
        <div>
          <strong>Free-voltage curve</strong>
          {" · "}
          <span class="muted">{data.pointCount} points</span>
          {data.parasitic.ceilingV != null && (
            <>
              {" · "}
              <span class="muted">parasitic ceiling {data.parasitic.ceilingV} V</span>
            </>
          )}
          {data.parasitic.totalDrainWh > 0 && (
            <>
              {" · "}
              <span class="muted">drain {data.parasitic.totalDrainWh.toFixed(2)} Wh</span>
            </>
          )}
          {lastFetch && (
            <>
              {" · "}
              <span class="muted">computed {fmtTime(lastFetch)}</span>
            </>
          )}
        </div>
        <div style="display:flex;gap:0.4rem;">
          <button onClick={load} disabled={refreshing} class="fvt-copy" style="background:var(--panel);border:1px solid var(--border);">
            {refreshing ? "…" : "Refresh"}
          </button>
          <button onClick={copyToClipboard} class="fvt-copy">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <table class="fvt-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th class="num">V</th>
            <th class="num">W</th>
            <th>Zone</th>
          </tr>
        </thead>
        <tbody>
          {data.recommendation.map((p, i) => {
            const z = classify(p.voltage, data.parasitic.ceilingV, observedMaxV);
            return (
              <tr key={i}>
                <td class="num muted">{i + 1}</td>
                <td class="num">{p.voltage.toFixed(1)}</td>
                <td class="num">{Math.round(p.power).toLocaleString()}</td>
                <td><span class={zoneClass(z)}>{zoneLabel(z)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <details class="fvt-paste">
        <summary class="muted">Paste-ready format</summary>
        <pre>{data.recommendation.map((p) => `${p.voltage} ${Math.round(p.power)}`).join("\n")}</pre>
      </details>
    </div>
  );
}
