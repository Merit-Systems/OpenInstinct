import { defineTool } from "eve/tools";
import {
  feedbackIdempotencyKey,
  feedbackInputSchema,
  normalizeFeedback,
} from "../../lib/feedback.js";
import { saveFeedback } from "../../db/services/feedback.js";
import { scopeFromPrincipal } from "../../lib/access-scope.js";

export default defineTool({
  description:
    "Store feedback this authenticated user explicitly wants to give about Local Vault Assistant, including a bug report, improvement idea, compliment, or general product feedback. Do not use for ordinary requests or inferred dissatisfaction.",
  inputSchema: feedbackInputSchema,
  async execute(input, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");

    const feedback = normalizeFeedback(input.feedback);
    const saved = await saveFeedback(scopeFromPrincipal(caller), {
      ...input,
      feedback,
      idempotencyKey: feedbackIdempotencyKey({
        ...input,
        feedback,
        sessionId: ctx.session.id,
        turnId: ctx.session.turn.id,
      }),
      sessionId: ctx.session.id,
      toolCallId: ctx.callId,
      turnId: ctx.session.turn.id,
    });

    return { category: saved.category, feedbackId: saved.id, saved: true };
  },
});
