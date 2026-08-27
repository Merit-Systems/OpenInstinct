/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; the handler remains contextually type-checked against LinqChannelConfig. */
import type { LinqChannelConfig } from "eve/channels/linq";

type LinqMessageCompletedHandler = NonNullable<
  NonNullable<LinqChannelConfig["events"]>["message.completed"]
>;

export const deliverCompletedLinqMessage: LinqMessageCompletedHandler = async (
  event,
  context
) => {
  if (event.finishReason === "tool-calls") {
    context.state.pendingToolCallMessage = event.message
      ? (firstNonEmptyLine(event.message) ?? null)
      : null;
    return;
  }

  context.state.pendingToolCallMessage = null;
  if (!event.message || !context.thread) return;

  // Linq/iMessage supports raw text. Passing Markdown through Chat SDK's
  // converter collapses soft line breaks and can concatenate adjacent lines.
  await context.thread.post(event.message);
};

function firstNonEmptyLine(message: string) {
  return message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}
