import type { HookEvent } from "eve/hooks";
import { z } from "zod";

export interface TraceTimelineRow {
  readonly at: string;
  readonly detail: string;
  readonly id: string;
  readonly label: string;
  readonly type: string;
}

const detailCharacterLimit = 600;

function compactJson(value: Parameters<typeof JSON.stringify>[0]) {
  const serialized = JSON.stringify(value, (_key, entry) => {
    const text = z.string().safeParse(entry);
    if (text.success && text.data.length > 200) {
      return `${text.data.slice(0, 200)}… [${String(text.data.length)} chars]`;
    }
    const jsonValue = z.json().safeParse(entry);
    return jsonValue.success ? jsonValue.data : undefined;
  });
  return serialized.length > detailCharacterLimit
    ? `${serialized.slice(0, detailCharacterLimit)}…`
    : serialized;
}

export function traceTimelineRows(event: HookEvent): TraceTimelineRow[] {
  const id = event.meta.id;
  if (!id) return [];
  const at = event.meta.at;
  const row = (label: string, detail: string): TraceTimelineRow => ({
    at,
    detail: detail.slice(0, detailCharacterLimit),
    id,
    label,
    type: event.type,
  });

  switch (event.type) {
    case "message.received":
      return [row("Task received", event.data.message)];
    case "actions.requested":
      return event.data.actions.map((action, index) => ({
        at,
        detail: compactJson(action.input),
        id: `${id}:${String(index)}`,
        label:
          action.kind === "tool-call"
            ? action.toolName
            : action.kind === "load-skill"
              ? "Load skill"
              : action.name,
        type: event.type,
      }));
    case "action.result": {
      const result = event.data.result;
      const name =
        result.kind === "tool-result"
          ? result.toolName
          : result.kind === "subagent-result"
            ? result.subagentName
            : "load-skill";
      return [
        row(
          `${name} → ${result.isError ? "error" : "result"}`,
          compactJson(result.output)
        ),
      ];
    }
    case "message.completed":
      return [row("Assistant", event.data.message ?? "")];
    case "result.completed":
      return [row("Final output", compactJson(event.data.result))];
    case "input.requested":
      return [
        row(
          "Input requested",
          `${String(event.data.requests.length)} pending request(s)`
        ),
      ];
    case "input.resolved":
      return [row("Input resolved", compactJson(event.data.resolutions))];
    case "authorization.required":
      return [row("Authorization required", event.data.name)];
    case "authorization.completed":
      return [row("Authorization", event.data.outcome)];
    case "step.failed":
      return [row("Step failed", event.data.message)];
    case "turn.failed":
      return [row("Turn failed", event.data.message)];
    case "turn.cancelled":
      return [row("Turn cancelled", "")];
    case "turn.completed":
      return [row("Turn completed", "")];
    case "session.started":
      return [row("Session started", "")];
    case "session.failed":
      return [row("Session failed", "")];
    case "session.completed":
      return [row("Session completed", "")];
    case "compaction.requested":
      return [row("Context compaction", "")];
    default:
      return [];
  }
}
