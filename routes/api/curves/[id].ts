import { getDb } from "../../../lib/state.ts";
import { getCurve, updateCurveNotes } from "../../../lib/curves.ts";
import { deleteCurveBlocked } from "../../../lib/activations.ts";

function parseId(params: { id: string }): number | null {
  const id = parseInt(params.id, 10);
  return Number.isFinite(id) ? id : null;
}

export const handler = {
  GET(ctx: { params: { id: string } }) {
    const id = parseId(ctx.params);
    if (id == null) return new Response("bad id", { status: 400 });
    const c = getCurve(getDb(), id);
    if (!c) return new Response("not found", { status: 404 });
    return Response.json(c);
  },
  async PATCH(ctx: { req: Request; params: { id: string } }) {
    const id = parseId(ctx.params);
    if (id == null) return new Response("bad id", { status: 400 });
    const body = await ctx.req.json() as { notes?: string | null };
    updateCurveNotes(getDb(), id, body.notes ?? null);
    return new Response(null, { status: 204 });
  },
  DELETE(ctx: { params: { id: string } }) {
    const id = parseId(ctx.params);
    if (id == null) return new Response("bad id", { status: 400 });
    try {
      deleteCurveBlocked(getDb(), id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
