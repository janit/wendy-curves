import { assertEquals } from "@std/assert";
import { HttpWendySource } from "./wendy-source.ts";
import type { WendyHistoryRow } from "./types.ts";
import type { ArchiveDayMeta } from "./wendy-source.ts";

function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; close: () => Promise<void> } {
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, handler);
  const addr = server.addr as Deno.NetAddr;
  return {
    url: `http://${addr.hostname}:${addr.port}`,
    close: async () => { ac.abort(); await server.finished; },
  };
}

Deno.test("HttpWendySource.fetchHistory passes from/to/source", async () => {
  let receivedQuery = "";
  const mock = startMockServer((req) => {
    receivedQuery = new URL(req.url).search;
    const rows: WendyHistoryRow[] = [
      { ts: 100, source: "tristar", power: 200, voltage: 90, current: 2.2, temp: 30, mode: "48v" },
    ];
    return new Response(JSON.stringify(rows), {
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    const src = new HttpWendySource(mock.url, null);
    const rows = await src.fetchHistory(1000, 2000, "tristar");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].source, "tristar");
    assertEquals(receivedQuery.includes("from=1000"), true);
    assertEquals(receivedQuery.includes("to=2000"), true);
    assertEquals(receivedQuery.includes("source=tristar"), true);
  } finally {
    await mock.close();
  }
});

Deno.test("HttpWendySource.fetchHistory sends bearer token when configured", async () => {
  let authHeader = "";
  const mock = startMockServer((req) => {
    authHeader = req.headers.get("authorization") ?? "";
    return new Response("[]", { headers: { "Content-Type": "application/json" } });
  });
  try {
    const src = new HttpWendySource(mock.url, "secret123");
    await src.fetchHistory(0, 1, null);
    assertEquals(authHeader, "Bearer secret123");
  } finally {
    await mock.close();
  }
});

Deno.test("HttpWendySource.openEventStream receives events from a mock SSE server", async () => {
  const events: unknown[] = [];
  let mock: ReturnType<typeof startMockServer> | null = null;

  await new Promise<void>((resolve, reject) => {
    mock = startMockServer((_req) => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ arrayVoltage: 95 })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ arrayVoltage: 96 })}\n\n`));
          // Keep open
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    });

    const src = new HttpWendySource(mock!.url, null);
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const close = src.openEventStream(
      (data) => {
        events.push(data);
        if (events.length === 2) {
          resolved = true;
          if (timeoutId !== null) clearTimeout(timeoutId);
          close();
          resolve();
        }
      },
      (err) => {
        if (!resolved) reject(err);
      },
    );

    timeoutId = setTimeout(() => {
      if (!resolved) {
        close();
        reject(new Error("timeout waiting for SSE events"));
      }
    }, 3000);
  });

  await mock!.close();
  assertEquals(events.length, 2);
  assertEquals((events[0] as { arrayVoltage: number }).arrayVoltage, 95);
});

Deno.test("HttpWendySource.fetchArchiveDays returns parsed day metadata", async () => {
  let receivedQuery = "";
  const mock = startMockServer((req) => {
    receivedQuery = new URL(req.url).search;
    return new Response(JSON.stringify([
      { date: "2026-04-01", row_count: 86400, ts_start: 1, ts_end: 2, format: "gzip-cols-v1", created_at: 3 },
    ] as ArchiveDayMeta[]), { headers: { "Content-Type": "application/json" } });
  });
  try {
    const src = new HttpWendySource(mock.url, null);
    const days = await src.fetchArchiveDays("2026-03-25", "2026-04-07");
    assertEquals(days.length, 1);
    assertEquals(days[0].date, "2026-04-01");
    assertEquals(receivedQuery.includes("from=2026-03-25"), true);
    assertEquals(receivedQuery.includes("to=2026-04-07"), true);
  } finally {
    await mock.close();
  }
});

Deno.test("HttpWendySource.fetchArchiveDays returns [] on 503", async () => {
  const mock = startMockServer(() => {
    return new Response(JSON.stringify({ error: "archive not enabled" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    const src = new HttpWendySource(mock.url, null);
    const days = await src.fetchArchiveDays("2026-01-01", "2026-12-31");
    assertEquals(days, []);
  } finally {
    await mock.close();
  }
});

Deno.test("HttpWendySource.fetchArchiveDay returns rows for a date", async () => {
  const mock = startMockServer((req) => {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/2026-04-01")) return new Response("bad path", { status: 500 });
    const rows: WendyHistoryRow[] = [
      { ts: 100, source: "tristar", power: 200, voltage: 90, current: 2.2, temp: 30, mode: "48v" },
      { ts: 101, source: "tristar", power: 210, voltage: 91, current: 2.3, temp: 30, mode: "48v" },
    ];
    return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
  });
  try {
    const src = new HttpWendySource(mock.url, null);
    const rows = await src.fetchArchiveDay("2026-04-01", "tristar");
    assertEquals(rows.length, 2);
    assertEquals(rows[0].ts, 100);
  } finally {
    await mock.close();
  }
});

Deno.test("HttpWendySource.fetchArchiveDay returns [] on 404", async () => {
  const mock = startMockServer(() => {
    return new Response(JSON.stringify({ error: "not archived" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    const src = new HttpWendySource(mock.url, null);
    const rows = await src.fetchArchiveDay("1999-12-31", "tristar");
    assertEquals(rows, []);
  } finally {
    await mock.close();
  }
});
