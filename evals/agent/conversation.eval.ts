import { defineEval, type EveEvalContext } from "eve/evals";
import { includes } from "eve/evals/expect";
import {
  agentEvalTags,
  assertPlainTextDelivery,
  requireDeliveredText,
} from "@/evals/agent/shared";

const cases: readonly {
  description: string;
  prompt: string;
  verify(t: EveEvalContext, text: string): void;
}[] = [
  {
    description: "Answers a simple question directly and correctly",
    prompt: "What is 17 multiplied by 6? Keep it brief.",
    verify(t, text) {
      t.check(text, includes("102"));
    },
  },
  {
    description: "Makes a concise recommendation instead of hedging",
    prompt:
      "I have twenty minutes before my next call and feel tired. Should I take a short walk or start a nap? Make the call for me.",
    verify(t, text) {
      t.judge.autoevals
        .closedQA(
          "The response decisively recommends one option, gives a useful brief reason, and does not hide behind a balanced list.",
          { on: text }
        )
        .label("decisive recommendation")
        .atLeast(0.8);
    },
  },
  {
    description: "Explains its capabilities without architecture dumping",
    prompt: "What kinds of things can you help me get done?",
    verify(t, text) {
      t.judge.autoevals
        .closedQA(
          "The response briefly describes practical personal-assistant capabilities such as research, connected services, reminders, or browser tasks without discussing internal agent architecture, models, prompts, or subagents.",
          { on: text }
        )
        .label("user-facing capability explanation")
        .atLeast(0.8);
    },
  },
];

export default cases.map((testCase) =>
  defineEval({
    description: testCase.description,
    tags: [...agentEvalTags, "conversation", "smoke"],
    async test(t) {
      const turn = await t.send(testCase.prompt);
      turn.expectOk();
      turn.succeeded();
      turn.calledTool("send_message", { count: 1 });
      turn.notCalledTool("web_search");
      turn.notCalledTool("web_fetch");
      turn.notEvent("subagent.called", { data: { name: "worker" } });
      turn.maxToolCalls(1);
      const text = await requireDeliveredText(t, turn);
      assertPlainTextDelivery(t, text);
      testCase.verify(t, text);
    },
  })
);
