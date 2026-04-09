# wendy-curves

##  Wind Turbine Power Curve Tuning Tool

Power-curve tuning tool for a wind turbine driving a **Morningstar TriStar
600V MPPT** charge controller. Built with **Deno + Fresh**, SQLite, and
Canvas-2D scatter plots. Companion to [wendy](https://github.com/janit/wendy),
the data-collection dashboard that feeds it live samples.

> **Read-only.** `wendy-curves` observes and analyses — it does **not** write
> to the TriStar controller. All curve changes are still applied manually.
> A future optional Modbus write path is gated behind `WENDY_CURVES_ALLOW_WRITE=1`
> and is not implemented yet.

`wendy-curves` consumes wendy's live data via SSE, archives samples in its
own SQLite, lets you record which voltage→watts curve was loaded between
which timestamps, and helps find a better curve by:

- Plotting all observed (array V, array W) samples with the active curve,
  the empirical p90 envelope, and a suggested curve overlaid.
- Scoring the active curve against the previous one on energy yield and
  stall count.
- Generating a 16-setpoint suggested curve under monotonicity, hardware
  cap, stall hotspot back-off, and small-step constraints.

## Status

Phase 1 implemented:

- Bootstrap consumer: SSE + history fetch from wendy
- SQLite long-term archive (curves, activations, samples, metrics cache)
- Pure analyzer: envelope, stalls, suggestion algorithm, verdict label
- Fresh UI: scatter plot, setpoint table, curve drawer, activation timeline, live footer
- Docker + deploy script

Phase 2 (direct Modbus curve write to TriStar) is out of scope; tracked
as a follow-up. Set `WENDY_CURVES_ALLOW_WRITE=1` will be required to
enable it once implemented.

## Architecture

```
wendy ──SSE/HTTP──► wendy-curves ──► wendy-curves.db (long-term archive)
                          │
                          ▼
                       Analyzer (pure)
                          │
                          ▼
                    Fresh app (scatter UI)
                          :
                          └──► CurveWriter (phase 2: Modbus)
```

`wendy-curves` is conceptually "another display consumer" of wendy — it
talks to wendy over HTTP/SSE rather than reading wendy's database
directly. Wendy keeps its own 7-day hot window plus a compressed
365-day cold archive; wendy-curves keeps its own independent long-term
archive tuned for power-curve analysis.

## Requirements

- [**wendy**](https://github.com/janit/wendy) reachable via HTTP/SSE
  (exposes `tristarPower` on `/api/events` and `?from=&to=&source=`
  query parameters on `/api/history`)
- [Deno](https://deno.com) 2.x (or [Docker](https://www.docker.com/) via
  the bundled `Dockerfile` + `docker-compose.yml`)

## Quickstart

```bash
# Copy the example env file and point at a running wendy instance
cp .env.example .env
# edit .env — at minimum set WENDY_CURVES_WENDY_URL to your wendy host

# Run locally
deno task dev

# Or via Docker
docker compose up
```

The dashboard is served on `WENDY_CURVES_PORT` (default `8087`). See
`.env.example` for the full list of configuration options.

## Tech Stack

- **Deno 2.x / Fresh 2 / TypeScript** — server and UI
- **SQLite** (via `@db/sqlite`) — long-term sample archive
- **Server-Sent Events** — live ingest from wendy
- **Canvas 2D** — scatter plot rendering (no charting library)
- **Docker** — optional containerised deployment

## Related Projects

- [**wendy**](https://github.com/janit/wendy) — the energy-dashboard
  sibling that polls Morningstar TriStar and Victron hardware via
  Modbus TCP and serves the live SSE stream wendy-curves consumes.

## License

MIT
