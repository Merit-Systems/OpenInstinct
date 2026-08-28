import { defineHook } from "eve/hooks";
import {
  clearWorkerCancellationTurn,
  recordWorkerCancellationTurn,
} from "../lib/worker-cancellation-delivery";

export default defineHook({
  events: {
    "message.received"(event, ctx) {
      recordWorkerCancellationTurn(
        ctx.session.id,
        event.data.turnId,
        event.data.message
      );
    },
    "turn.cancelled"(event, ctx) {
      clearWorkerCancellationTurn(ctx.session.id, event.data.turnId);
    },
    "turn.completed"(event, ctx) {
      clearWorkerCancellationTurn(ctx.session.id, event.data.turnId);
    },
    "turn.failed"(event, ctx) {
      clearWorkerCancellationTurn(ctx.session.id, event.data.turnId);
    },
  },
});
