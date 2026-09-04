import { defineEval } from "eve/evals";
import { z } from "zod";
import {
  agentEvalTags,
  assertPlainTextDelivery,
  requireDeliveredText,
} from "@/evals/agent/shared";

const configureInputSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean()])
);

const cases = [
  {
    description: "Turns off a proaction when the user asks for less of it",
    expected: { enabled: false, proactionId: "bill-savings" },
    prompt:
      "stop telling me about cheaper internet and phone plans, i don't want those bill savings checks anymore",
  },
  {
    description: "Raises autonomy when the user asks the agent to just act",
    expected: { autonomy: "auto", proactionId: "flight-price-watch" },
    prompt:
      "next time one of my booked flights gets cheaper, just rebook it for the credit and tell me after",
  },
] as const;

export default cases.map((testCase) =>
  defineEval({
    description: testCase.description,
    tags: [...agentEvalTags, "proactions"],
    async test(t) {
      const turn = await t.send(testCase.prompt);
      turn.expectOk();
      turn.succeeded();
      turn.calledTool("proactions-configure", {
        count: 1,
        input: (input) => {
          const parsed = configureInputSchema.safeParse(input);
          return (
            parsed.success &&
            Object.entries(testCase.expected).every(
              ([key, value]) => parsed.data[key] === value
            )
          );
        },
        status: "completed",
      });
      turn.notEvent("subagent.called", { data: { name: "browser-agent" } });
      const text = await requireDeliveredText(t, turn);
      assertPlainTextDelivery(t, text);
    },
  })
);
