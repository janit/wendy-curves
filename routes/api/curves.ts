import { getDb } from "../../lib/state.ts";
import { listCurves, createCurve } from "../../lib/curves.ts";
import type { CurvePoint } from "../../lib/types.ts";

export const handler = {
  GET() {
    return Response.json(listCurves(getDb()));
  },
  async POST(ctx: { req: Request }) {
    const body = await ctx.req.json() as {
      name?: string;
      notes?: string | null;
      source?: "manual" | "suggested" | "imported";
      points?: CurvePoint[];
    };
    if (!body.name || !Array.isArray(body.points) || body.points.length === 0) {
      return new Response(JSON.stringify({ error: "name and points required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const id = createCurve(getDb(), {
        name: body.name,
        notes: body.notes ?? null,
        source: body.source ?? "manual",
        points: body.points,
      });
      return Response.json({ id }, { status: 201 });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
