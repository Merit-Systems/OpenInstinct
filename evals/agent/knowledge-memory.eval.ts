import { memoryScenarioRepetitions } from "@evals/memory/scenarios";
import { defineEval } from "eve/evals";
import { env } from "@shared/environment";
import { agentEvalTags, requireDeliveredText } from "@evals/agent/shared";

export default memoryScenarioRepetitions.map((repetition) =>
  defineEval({
    description: `Remember, correct, recall and forget across fresh sessions; repetition ${String(repetition)}`,
    tags: [...agentEvalTags, "knowledge-memory"],
    timeoutMs: 300_000,
    async test(t) {
      if (env.KNOWLEDGE_MEMORY_MODE !== "enabled") {
        t.skip("Set KNOWLEDGE_MEMORY_MODE=enabled for this opt-in evaluation.");
        return;
      }
      const topic = `marigold-${String(repetition)} train trips`;
      let remembered = false;
      let forgotten = false;
      try {
        const first = await t.send(
          `Remember this preference: I prefer a window seat in the quiet car for my ${topic}.`
        );
        first.expectOk();
        first.succeeded();
        first.requireToolCall("knowledge__remember", { status: "completed" });
        remembered = true;
        await requireDeliveredText(t, first);

        const correctionSession = await t.session();
        const correction = await correctionSession.send(
          `Correct only my saved preference for ${topic}: I now prefer an aisle seat in the quiet car for my ${topic}. Replace that old preference.`
        );
        correction.expectOk();
        correction.succeeded();
        correction.requireToolCall("knowledge__correct", {
          status: "completed",
        });
        await requireDeliveredText(t, correction);

        const recallSession = await t.session();
        const recall = await recallSession.send(
          `What seating preference should you use for my ${topic}, and what is the evidence?`
        );
        recall.expectOk();
        recall.succeeded();
        const recalled = await requireDeliveredText(t, recall);
        t.judge(
          "The response says the user's current preference is an aisle seat in the quiet car, attributes it to the user's correction, and does not recommend a window seat as their current preference. It does not invent a source or claim to have booked travel.",
          { on: recalled }
        ).atLeast(0.9);

        const deletion = await recallSession.send(
          `Forget only my saved seating preference for ${topic}, including its prior versions.`
        );
        deletion.expectOk();
        deletion.succeeded();
        deletion.requireToolCall("knowledge__forget", { status: "completed" });
        await requireDeliveredText(t, deletion);
        forgotten = true;

        const laterSession = await t.session();
        const later = await laterSession.send(
          `Do you have a saved seating preference for my ${topic}?`
        );
        later.expectOk();
        later.succeeded();
        const answer = await requireDeliveredText(t, later);
        t.judge(
          `The response correctly says no saved seating preference for ${topic} is available, or asks the user to supply one. It does not state or imply the forgotten window-seat, aisle-seat or quiet-car preference for this named trip category is still known. General suggestions and other trip categories are clearly distinguished from remembered facts for ${topic}.`,
          { on: answer }
        ).atLeast(0.9);
      } finally {
        if (!forgotten) {
          const cleanup = await t.session();
          const result = await cleanup.send(
            `Forget only any saved seating preference for ${topic}, including all its prior versions.`
          );
          result.expectOk();
          result.succeeded();
          if (remembered)
            result.requireToolCall("knowledge__forget", {
              status: "completed",
            });
          await requireDeliveredText(t, result);
        }
      }
    },
  })
);
