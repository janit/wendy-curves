import { useEffect, useRef, useState } from "preact/hooks";

interface MarsrockBin {
  voltage: number;
  sampleCount: number;
  pMedian: number;
  pP90: number;
  pMax: number;
}

interface DualInsightsData {
  window: { tsFrom: number; tsTo: number; totalSamples: number };
  marsrock: {
    bins: MarsrockBin[];
    harvestWh: number;
    peakW: number;
    activeSamples: number;
  };
  tristar: {
    harvestWh: number;
    peakW: number;
    activeSamples: number;
  };
  coil: {
    drainWh: number;
    meanDrainW: number;
    sampleCount: number;
  };
  modeDistribution: {
    in24v: number;
    in48v: number;
    total: number;
  };
  raw: {
    scatterPoints: Array<{ voltage: number; power: number; mode: string }>;
  };
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function fmtWh(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${wh.toFixed(1)} Wh`;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

export default function DualInsights() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [data, setData] = useState<DualInsightsData | null>(null);
  const [today, setToday] = useState<{ today: number; today24v: number; today48v: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [res, snap] = await Promise.all([
        fetch("/api/dual-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        fetch("/api/snapshot"),
      ]);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = await res.json();
      setData(j);
      setLastFetch(new Date());
      setError(null);
      const snapJson = await snap.json();
      const state = snapJson.lastEvent?.state as any;
      if (state && typeof state.todayKwh24v === "number") {
        setToday({
          today: (state.todayKwh ?? 0) * 1000,
          today24v: (state.todayKwh24v ?? 0) * 1000,
          today48v: (state.todayKwh48v ?? 0) * 1000,
        });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Draw the scatter canvas whenever data changes
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !data) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const W = cv.width;
    const H = cv.height;
    const PAD = 45;

    // Determine axis ranges from data
    const allV = data.raw.scatterPoints.map((p) => p.voltage);
    const allPow = data.raw.scatterPoints.map((p) => p.power);
    const binVoltages = data.marsrock.bins.map((b) => b.voltage);

    const vMin = allV.length > 0 ? Math.floor(Math.min(...allV, ...binVoltages)) : 0;
    const vMax = allV.length > 0 ? Math.ceil(Math.max(...allV, ...binVoltages)) + 2 : 60;
    const pMin = 0;
    const pMax = data.marsrock.peakW > 0 ? Math.ceil(data.marsrock.peakW * 1.1 / 100) * 100 : 500;

    function project(v: number, w: number): [number, number] {
      const x = PAD + ((v - vMin) / (vMax - vMin || 1)) * (W - PAD * 2);
      const y = H - PAD - ((w - pMin) / (pMax - pMin || 1)) * (H - PAD * 2);
      return [x, y];
    }

    ctx.fillStyle = "#181a1f";
    ctx.fillRect(0, 0, W, H);

    // Axes
    ctx.strokeStyle = "#444a55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, H - PAD);
    ctx.lineTo(W - PAD, H - PAD);
    ctx.moveTo(PAD, H - PAD);
    ctx.lineTo(PAD, PAD);
    ctx.stroke();

    // X axis labels (voltage)
    ctx.fillStyle = "#8a8f98";
    ctx.font = "11px system-ui";
    const vStep = vMax - vMin <= 20 ? 2 : vMax - vMin <= 40 ? 5 : 10;
    for (let v = Math.ceil(vMin / vStep) * vStep; v <= vMax; v += vStep) {
      const [x] = project(v, 0);
      ctx.fillText(`${v}V`, x - 10, H - PAD + 14);
    }

    // Y axis labels (power)
    const pStep = pMax <= 200 ? 50 : pMax <= 1000 ? 100 : 500;
    for (let w = 0; w <= pMax; w += pStep) {
      const [, y] = project(0, w);
      ctx.fillText(`${w}`, 2, y + 4);
    }

    // Axis titles
    ctx.fillStyle = "#8a8f98";
    ctx.font = "11px system-ui";
    ctx.fillText("W", 4, PAD - 6);
    ctx.fillText("V", W - PAD + 4, H - PAD + 14);

    // Scatter dots (faint)
    ctx.fillStyle = "rgba(150,180,255,0.15)";
    for (const pt of data.raw.scatterPoints) {
      const [x, y] = project(pt.voltage, pt.power);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    // P90 envelope line (orange dashed)
    if (data.marsrock.bins.length > 0) {
      ctx.strokeStyle = "#ffaa55";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      data.marsrock.bins.forEach((b, i) => {
        const [x, y] = project(b.voltage, b.pP90);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Legend
      ctx.strokeStyle = "#ffaa55";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD + 5, PAD + 8);
      ctx.lineTo(PAD + 30, PAD + 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#8a8f98";
      ctx.font = "11px system-ui";
      ctx.fillText("p90 envelope", PAD + 35, PAD + 12);
    }
  }, [data]);

  const copyCurve = async () => {
    if (!data || data.marsrock.bins.length === 0) return;
    const lines = [
      "// 24V Marsrock (inferred)",
      ...data.marsrock.bins.map((b) => `${b.voltage.toFixed(1)}  ${Math.round(b.pP90)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  if (error) return <div class="muted">Failed to load: {error}</div>;
  if (!data) return <div class="muted">Loading…</div>;

  const { marsrock, tristar, coil, modeDistribution } = data;

  return (
    <div class="dual-insights">
      <div class="di-header">
        <div>
          <strong>24/48V mode insights</strong>
          {" · "}
          <span class="muted">{data.window.totalSamples.toLocaleString()} samples</span>
          {lastFetch && (
            <>
              {" · "}
              <span class="muted">fetched {fmtTime(lastFetch)}</span>
            </>
          )}
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          class="fvt-copy"
          style="background:var(--panel);border:1px solid var(--border);"
        >
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>

      {today && (
        <div class="di-today-row">
          <div class="di-today-card">
            <h3>Marsrock today</h3>
            <div class="primary">{Math.round(today.today24v)} Wh</div>
            <div class="secondary">from wendy's BMV-700 counter</div>
          </div>
          <div class="di-today-card">
            <h3>TriStar today</h3>
            <div class="primary">{Math.round(today.today48v)} Wh</div>
            <div class="secondary">from wendy's 48V shunt counter</div>
          </div>
          <div class="di-today-card">
            <h3>Total today</h3>
            <div class="primary">{Math.round(today.today)} Wh</div>
            <div class="secondary">24V + 48V combined</div>
          </div>
        </div>
      )}

      <div class="di-cards">
        <div class="di-card">
          <h3>Marsrock · Window delta</h3>
          <div class="primary">{fmtWh(marsrock.harvestWh)}</div>
          <div class="secondary">
            peak {Math.round(marsrock.peakW)} W
            {" · "}{marsrock.activeSamples.toLocaleString()} active samples
          </div>
          <div class="secondary" style="margin-top:0.4rem;font-style:italic;">
            counter-based; shows 0 until ~10 Wh of harvest since wendy-curves started capturing BMV counters
          </div>
        </div>

        <div class="di-card">
          <h3>TriStar · Window delta</h3>
          <div class="primary">{fmtWh(tristar.harvestWh)}</div>
          <div class="secondary">
            peak {Math.round(tristar.peakW)} W
            {" · "}{tristar.activeSamples.toLocaleString()} active samples
          </div>
          <div class="secondary" style="margin-top:0.4rem;font-style:italic;">
            counter-based; shows 0 until ~10 Wh of harvest since wendy-curves started capturing BMV counters
          </div>
        </div>

        <div class="di-card">
          <h3>Relay coil drain</h3>
          <div class="primary">{fmtWh(coil.drainWh)}</div>
          <div class="secondary">
            mean {coil.meanDrainW.toFixed(1)} W
            {" · "}{coil.sampleCount.toLocaleString()} samples
          </div>
        </div>

        <div class="di-card">
          <h3>Mode distribution</h3>
          <div class="primary">
            {pct(modeDistribution.in24v, modeDistribution.total)} 24V
          </div>
          <div class="secondary">
            {pct(modeDistribution.in48v, modeDistribution.total)} 48V
            {" · "}{modeDistribution.total.toLocaleString()} total
          </div>
        </div>
      </div>

      <div class="di-chart">
        <h3>Marsrock 24V curve (inferred from observed samples)</h3>
        <canvas
          ref={canvasRef}
          width={1100}
          height={400}
          style="width:100%;height:auto;display:block"
        />
        <div class="di-actions">
          <button
            onClick={copyCurve}
            disabled={marsrock.bins.length === 0}
            class="fvt-copy"
          >
            {copied ? "Copied!" : "Copy curve"}
          </button>
          <span class="muted" style="font-size:0.8rem;align-self:center;">
            {marsrock.bins.length > 0
              ? `${marsrock.bins.length} bins from ${marsrock.bins[0].voltage.toFixed(1)}V to ${marsrock.bins[marsrock.bins.length - 1].voltage.toFixed(1)}V`
              : "No data yet"}
          </span>
        </div>
      </div>
    </div>
  );
}
