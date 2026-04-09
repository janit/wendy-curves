import { boot } from "./lib/boot.ts";

const port = await boot();

const mod = await import("./_fresh/server/server-entry.mjs");
const handler = mod.default;

const server = Deno.serve(
  {
    port,
    hostname: "0.0.0.0",
    onError(err) {
      console.error("[serve] request error:", err);
      return new Response("Internal Server Error", { status: 500 });
    },
  },
  (req: Request) => {
    try {
      return handler.fetch(req);
    } catch (err) {
      console.error("[serve] fetch error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
);

console.log(`[wendy-curves] http://localhost:${port}`);
await server.finished;
