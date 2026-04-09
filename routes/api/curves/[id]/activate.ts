import { getDb } from "../../../../lib/state.ts";
import { activateCurve } from "../../../../lib/activations.ts";
import { getCurve } from "../../../../lib/curves.ts";

export const handler = {
  async POST(ctx: { req: Request; params: { id: string } }) {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id)) return new Response("bad id", { status: 400 });
    const db = getDb();
    if (!getCurve(db, id)) return new Response("not found", { status: 404 });
    const body = await ctx.req.json().catch(() => ({})) as { note?: string | null };
    const ts = Math.floor(Date.now() / 1000);
    const activationId = activateCurve(db, id, ts, body.note ?? null);
    return Response.json({ activationId, ts }, { status: 201 });
  },
};
