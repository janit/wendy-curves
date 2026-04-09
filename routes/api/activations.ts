import { getDb } from "../../lib/state.ts";
import { listActivations } from "../../lib/activations.ts";

export const handler = {
  GET() {
    return Response.json(listActivations(getDb()));
  },
};
