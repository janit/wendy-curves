import { getDb } from "../../lib/state.ts";
import { getSamplesInWindow } from "../../lib/db.ts";

const MAX_ROWS = 100_000;

export const handler = {
  GET(ctx: { req: Request }) {
    const url = new URL(ctx.req.url);
    const now = Math.floor(Date.now() / 1000);
    const from = parseInt(url.searchParams.get("from") ?? String(now - 86400), 10);
    const to = parseInt(url.searchParams.get("to") ?? String(now), 10);

    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return new Response(JSON.stringify({ error: "invalid from/to" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = getSamplesInWindow(getDb(), from, to);
    if (rows.length > MAX_ROWS) {
      const stride = Math.ceil(rows.length / MAX_ROWS);
      const out = rows.filter((_, i) => i % stride === 0);
      return Response.json({ rows: out, downsampled: true, stride });
    }
    return Response.json({ rows, downsampled: false });
  },
};
