import { useEffect, useState } from "preact/hooks";
import type { Activation, Curve } from "../lib/types.ts";

export default function ActivationTimeline() {
  const [activations, setActivations] = useState<Activation[]>([]);
  const [curves, setCurves] = useState<Record<number, Curve>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/activations").then((r) => r.json()) as Promise<Activation[]>,
      fetch("/api/curves").then((r) => r.json()) as Promise<Curve[]>,
    ]).then(([acts, cs]) => {
      setActivations(acts);
      setCurves(Object.fromEntries(cs.map((c) => [c.id, c])));
    });
  }, []);

  if (activations.length === 0) return null;
  const start = activations[0].tsFrom;
  const end = Math.max(...activations.map((a) => a.tsTo ?? Math.floor(Date.now() / 1000)));
  const span = end - start || 1;

  return (
    <div class="timeline" style="margin-top:1rem;">
      <div class="muted" style="font-size:0.8rem;margin-bottom:0.25rem;">Activation timeline</div>
      <div style="position:relative;height:32px;background:var(--panel);border:1px solid var(--border);border-radius:3px;">
        {activations.map((a) => {
          const left = ((a.tsFrom - start) / span) * 100;
          const right = (((a.tsTo ?? end) - start) / span) * 100;
          const w = right - left;
          const c = curves[a.curveId];
          const color = `hsl(${(a.curveId * 73) % 360}, 60%, 45%)`;
          return (
            <div
              key={a.id}
              title={`${c?.name ?? `curve ${a.curveId}`}: ${new Date(a.tsFrom * 1000).toLocaleString()} → ${a.tsTo ? new Date(a.tsTo * 1000).toLocaleString() : "now"}`}
              style={`position:absolute;top:0;bottom:0;left:${left}%;width:${w}%;background:${color};border-right:1px solid var(--bg);`}
              onClick={() => console.log("clicked activation", a)}
            >
              <span style="font-size:0.7rem;padding-left:0.4rem;color:#fff;line-height:32px;white-space:nowrap;overflow:hidden;display:block;">
                {c?.name ?? `#${a.curveId}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
