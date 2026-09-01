import type { MessageStreamEvent } from "eve/client";

export function messageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    if (event.type === "message.received") {
      timestamps.set(`${event.data.turnId}:user`, event.meta.at);
    }

    if (
      event.type === "message.completed" &&
      event.data.finishReason !== "tool-calls"
    ) {
      timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
    }
  }

  return timestamps;
}

export function deliveredAssistantMessages(
  events: readonly MessageStreamEvent[]
) {
  const deliveriesByMessage = new Map<string, Map<number, string[]>>();

  for (const event of events) {
    if (
      event.type !== "message.completed" ||
      event.data.finishReason === "tool-calls" ||
      !event.data.message?.trim()
    ) {
      continue;
    }

    const messageId = `${event.data.turnId}:assistant`;
    const deliveries =
      deliveriesByMessage.get(messageId) ?? new Map<number, string[]>();
    const messages = deliveries.get(event.data.stepIndex) ?? [];
    messages.push(event.data.message);
    deliveries.set(event.data.stepIndex, messages);
    deliveriesByMessage.set(messageId, deliveries);
  }

  return deliveriesByMessage;
}
