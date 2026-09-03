import { defineEval } from "eve/evals";
import {
  agentEvalTags,
  assertPlainTextDelivery,
  requireDeliveredText,
} from "@/evals/agent/shared";

export default defineEval({
  description: "Delegates browser work and cancels it through task steering",
  tags: [...agentEvalTags, "browser-agent", "orchestration"],
  async test(t) {
    const delegated = await t.send(
      "Use the browser-agent subagent to visually inspect https://example.com and report the exact primary heading. Do not use web_fetch because this specifically requires browser interaction."
    );
    delegated.expectOk();
    delegated.succeeded();
    delegated.calledSubagent("browser-agent", {
      status: "completed",
      count: 1,
    });
    const acknowledgement = await requireDeliveredText(t, delegated);
    assertPlainTextDelivery(t, acknowledgement);

    const cancelled = await t.send("Cancel that browser task now.");
    cancelled.expectOk();
    cancelled.succeeded();
    cancelled.calledTool("task_cancel", {
      status: "completed",
      count: 1,
    });
    const confirmation = await requireDeliveredText(t, cancelled);
    assertPlainTextDelivery(t, confirmation);
  },
});
