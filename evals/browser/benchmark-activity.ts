import type { MessageStreamEvent } from "eve/client";
import { z } from "zod";
import {
  browserActivityKindForTool,
  type BrowserActivityKind,
  sumBrowserActivityDurations,
} from "@web/browser/activity";

const toolActivity = new Map<string, string>([
  ["browser_act", "Acting in the browser"],
  ["browser_find", "Finding page controls"],
  ["browser_snapshot", "Inspecting the page"],
  ["browser_text", "Reading the page"],
  ["capture_browser_image", "Capturing browser evidence"],
  ["computer_action", "Using visual browser controls"],
  ["fill_from_vault", "Securely filling saved user information"],
  ["list_vault", "Checking saved user information"],
  ["load_skill", "Loading the browser procedure"],
  ["manage_browsers", "Starting the browser"],
  ["playwright_execute", "Interacting with the page"],
  ["web_fetch", "Reading a public source"],
  ["web_search", "Searching for live options"],
]);

const managedBrowserOutputSchema = z.object({
  browser: z.object({ browser_live_view_url: z.url() }),
});

export function browserBenchmarkActivity(
  events: readonly MessageStreamEvent[]
) {
  for (const event of events.toReversed()) {
    if (event.type === "message.appended") {
      const message = activityLine(event.data.messageSoFar);
      if (message) return message;
    }
    if (event.type === "message.completed") {
      const message = activityLine(event.data.message ?? "");
      if (message) return message;
    }
    if (event.type === "actions.requested") {
      const activities = event.data.actions.map((action) => {
        if (action.kind === "load-skill")
          return "Loading the browser procedure";
        if (action.kind === "tool-call")
          return activityForTool(action.toolName);
        return "Coordinating browser work";
      });
      return [...new Set(activities)].join(" and ");
    }
    if (event.type === "action.result") {
      const result = event.data.result;
      if (result.kind === "tool-result") {
        return `Reviewing ${activityForTool(result.toolName).toLowerCase()} result`;
      }
    }
    if (event.type === "input.requested") return "Waiting for required input";
    if (event.type === "step.started") return "Planning the next step";
  }
  return null;
}

export function browserBenchmarkActivityDurations(
  events: readonly MessageStreamEvent[],
  now = Date.now()
) {
  return sumBrowserActivityDurations(
    events.flatMap((event) => {
      const kind = activityKindForEvent(event);
      return kind ? [{ at: Date.parse(event.meta.at), kind }] : [];
    }),
    now
  );
}

export function browserBenchmarkLiveViewUrl(
  events: readonly MessageStreamEvent[]
) {
  for (const event of events.toReversed()) {
    if (event.type !== "action.result") continue;
    const result = event.data.result;
    if (
      result.kind !== "tool-result" ||
      result.toolName !== "manage_browsers"
    ) {
      continue;
    }
    const parsed = managedBrowserOutputSchema.safeParse(result.output);
    if (!parsed.success) continue;
    try {
      const url = new URL(parsed.data.browser.browser_live_view_url);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.toString();
      }
    } catch {
      continue;
    }
  }
  return null;
}

function activityKindForEvent(
  event: MessageStreamEvent
): BrowserActivityKind | null {
  if (
    event.type === "step.started" ||
    event.type === "message.appended" ||
    event.type === "message.completed" ||
    event.type === "action.result"
  ) {
    return "model";
  }
  if (event.type === "input.requested") return "waiting";
  if (event.type !== "actions.requested") return null;

  const kinds = new Set(
    event.data.actions.map((action) => {
      if (action.kind === "load-skill") return "setup";
      if (action.kind === "tool-call") {
        return browserActivityKindForTool(action.toolName);
      }
      return "other";
    })
  );
  if (kinds.size !== 1) return "other";
  return kinds.values().next().value ?? "other";
}

function activityForTool(name: string) {
  return toolActivity.get(name) ?? `Running ${name.replaceAll("_", " ")}`;
}

function activityLine(value: string) {
  const line = value.replaceAll(/\s+/gu, " ").trim();
  if (!line) return null;
  return line.length > 180 ? `${line.slice(0, 179).trimEnd()}…` : line;
}
