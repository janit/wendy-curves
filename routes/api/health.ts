import { getConfig, isWendyConnected } from "../../lib/state.ts";

export const handler = {
  GET() {
    let analyzerVersion: number | null = null;
    try { analyzerVersion = getConfig().analyzerVersion; } catch { /* not booted */ }
    return new Response(
      JSON.stringify({
        status: "ok",
        analyzer_version: analyzerVersion,
        wendy_reachable: isWendyConnected(),
        version: Deno.env.get("WENDY_CURVES_VERSION") ?? "dev",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
