import { defineEval, type EveEvalContext } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { reactToMessageOutputSchema } from "@shared/chat/reaction";
import {
  agentEvalTags,
  assertPlainTextDelivery,
  requireDeliveredText,
} from "@evals/agent/shared";

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
  {
    description: "Condenses research into a useful iMessage recommendation",
    prompt: `You already found these showtimes for Spider-Man: Brand New Day tomorrow near Needham:
Showcase Legacy Place in Dedham, 4.6 miles away: 5:15 PM, 6:00 PM XPlus, 8:45 PM, 9:45 PM XPlus. The live seat map confirms the 6:00 PM show is available. Ticket link: https://tickets.example/legacy-place/very-long-checkout-link
Showcase SuperLux in Chestnut Hill, 5.2 miles away: 5:30 PM, 6:30 PM, 9:00 PM, 10:00 PM. Ticket link: https://tickets.example/superlux/very-long-checkout-link
West Newton Cinema, 5.2 miles away: 7:00 PM standard. Ticket link: https://tickets.example/west-newton/very-long-checkout-link
Nothing has been purchased. Tell me the useful result as you would in our normal conversation. I did not ask for every option or ticket link.`,
    verify(t, text) {
      t.check(text, includes("Legacy Place"));
      t.check(text, includes("6:00"));
      t.check(
        text,
        satisfies<string>(
          (value) =>
            value.length <= 400 &&
            value.split("\n").length <= 4 &&
            !/https?:\/\//u.test(value),
          "delivery is at most four compact lines and omits unrequested links"
        )
      );
      t.judge.autoevals
        .closedQA(
          "The response reads like a brief natural text message, leads with the 6:00 PM XPlus showing at Showcase Legacy Place as the best option, mentions that availability was confirmed and nothing was purchased, and does not dump the full research notes, every showtime, or multiple alternatives.",
          { on: text }
        )
        .label("concise research synthesis")
        .atLeast(0.8);
    },
  },
];

const textEvals = cases.map((testCase) =>
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
      turn.notEvent("subagent.called", { data: { name: "browser-agent" } });
      turn.maxToolCalls(1);
      const text = await requireDeliveredText(t, turn);
      assertPlainTextDelivery(t, text);
      testCase.verify(t, text);
    },
  })
);

const reactionEvals = [
  defineEval({
    description: "Uses a reaction for a lightweight acknowledgement",
    tags: [...agentEvalTags, "conversation", "reaction", "smoke"],
    async test(t) {
      const answered = await t.send("What is 2 plus 2?");
      answered.expectOk();
      await requireDeliveredText(t, answered);

      const thanked = await t.send("perfect, thanks!");
      thanked.expectOk();
      thanked.succeeded();
      thanked.calledTool("react_to_message", {
        count: 1,
        input: (input) => {
          const parsed = reactToMessageOutputSchema.safeParse(input);
          return (
            parsed.success &&
            parsed.data.operation === "add" &&
            ["heart", "thumbs_up"].includes(parsed.data.type)
          );
        },
        status: "completed",
      });
      thanked.notCalledTool("send_message");
      thanked.maxToolCalls(1);
    },
  }),
  defineEval({
    description: "Uses text when an acknowledgement also asks a question",
    tags: [...agentEvalTags, "conversation", "reaction", "smoke"],
    async test(t) {
      const answered = await t.send("What is 2 plus 2?");
      answered.expectOk();
      await requireDeliveredText(t, answered);

      const followUp = await t.send("thanks! what is 9 multiplied by 8?");
      followUp.expectOk();
      followUp.succeeded();
      followUp.calledTool("send_message", { count: 1, status: "completed" });
      followUp.notCalledTool("react_to_message");
      followUp.maxToolCalls(1);
      const text = await requireDeliveredText(t, followUp);
      assertPlainTextDelivery(t, text);
      t.check(text, includes("72"));
    },
  }),
];

export default [...textEvals, ...reactionEvals];
