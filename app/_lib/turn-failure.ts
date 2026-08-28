import { isTurnFailureEvent, type MessageStreamEvent } from "eve/client";

export function getLatestTurnFailure(
  events: readonly MessageStreamEvent[]
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;

    if (isTurnFailureEvent(event) && event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? "The model is temporarily unavailable. Please try again."
        : event.data.message;
    }
    if (
      event.type === "turn.completed" ||
      event.type === "turn.cancelled" ||
      event.type === "message.received"
    ) {
      return undefined;
    }
  }
  return undefined;
}
