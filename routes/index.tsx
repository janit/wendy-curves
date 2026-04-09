import { getDb, isWendyConnected, getLastEvent } from "../lib/state.ts";
import { currentActivation } from "../lib/activations.ts";
import { getCurve } from "../lib/curves.ts";
import { latestSampleTs } from "../lib/db.ts";
import ScatterPlot from "../islands/ScatterPlot.tsx";
import SetpointTable from "../islands/SetpointTable.tsx";
import DataStream from "../islands/DataStream.tsx";
import FreeVoltageTable from "../islands/FreeVoltageTable.tsx";
import DualInsights from "../islands/DualInsights.tsx";
import CurveDrawer from "../islands/CurveDrawer.tsx";
import ActivationTimeline from "../islands/ActivationTimeline.tsx";
import LiveFooter from "../islands/LiveFooter.tsx";

export default function Home() {
  const db = getDb();
  const act = currentActivation(db);
  const curve = act ? getCurve(db, act.curveId) : null;
  const newestTs = latestSampleTs(db);
  const oldestTs = db.prepare("SELECT MIN(ts) as t FROM samples").get<{ t: number | null }>()?.t ?? null;

  return (
    <html>
      <head>
        <title>wendy-curves</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <header>
          <div class="header-row">
            <h1>wendy-curves</h1>
            <div class="header-right">
              <LiveFooter
                initialConnected={isWendyConnected()}
                initialEvent={getLastEvent()}
                newestTs={newestTs}
                oldestTs={oldestTs}
              />
              <CurveDrawer />
            </div>
          </div>
          <div class="active-curve">
            {curve ? (
              <>
                Active: <strong>{curve.name}</strong>
                {act?.tsFrom != null && (
                  <span class="muted"> (since {new Date(act.tsFrom * 1000).toLocaleString()})</span>
                )}
              </>
            ) : (
              <em>No active curve</em>
            )}
          </div>
        </header>
        <main>
          <div class="tabs">
            <input type="radio" name="tab" id="tab-scatter" checked />
            <label for="tab-scatter">Scatter</label>
            <input type="radio" name="tab" id="tab-setpoints" />
            <label for="tab-setpoints">Wattage</label>
            <input type="radio" name="tab" id="tab-freevoltage" />
            <label for="tab-freevoltage">Free voltage</label>
            <input type="radio" name="tab" id="tab-dual" />
            <label for="tab-dual">24/48V</label>
            <input type="radio" name="tab" id="tab-stream" />
            <label for="tab-stream">Data stream</label>

            <div class="panel panel-scatter">
              <ScatterPlot curve={curve} />
            </div>
            <div class="panel panel-setpoints">
              <SetpointTable curve={curve} />
            </div>
            <div class="panel panel-freevoltage">
              <FreeVoltageTable />
            </div>
            <div class="panel panel-dual">
              <DualInsights />
            </div>
            <div class="panel panel-stream">
              <DataStream />
            </div>
          </div>
          <ActivationTimeline />
        </main>
      </body>
    </html>
  );
}
