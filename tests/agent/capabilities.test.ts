import type { DynamicResolveContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import worker from "@/agent/subagents/worker/agent";
import calendar from "@/agent/tools/calendar";
import contacts from "@/agent/tools/contacts";
import gmail from "@/agent/tools/gmail";
import messaging from "@/agent/tools/messaging";
import schedules from "@/agent/tools/schedules";
import updateUserProfile from "@/agent/tools/update_user_profile";
import vault from "@/agent/tools/vault";

const singletonTools = [["update_user_profile", updateUserProfile]] as const;

const groupedTools = [calendar, contacts, gmail, messaging, schedules, vault];

describe("authored mode capability matrix", () => {
  it("gives interactive turns the authored coordinator capabilities", async () => {
    expect(await authoredCapabilities("linq-message")).toEqual([
      "calendar-check-availability",
      "calendar-create-event",
      "calendar-list-events",
      "contacts-search",
      "gmail-read-thread",
      "gmail-search",
      "gmail-send",
      "gmail-update",
      "react_to_message",
      "request_vault_import",
      "request_vault_setup",
      "schedules-answer",
      "schedules-create",
      "schedules-list",
      "schedules-update",
      "send_message",
      "update_user_profile",
      "worker",
    ]);
  });

  it("gives scheduled workers only authored read and execution capabilities", async () => {
    expect(await authoredCapabilities("scheduled-worker")).toEqual([
      "calendar-check-availability",
      "calendar-list-events",
      "contacts-search",
      "gmail-read-thread",
      "gmail-search",
      "worker",
    ]);
  });

  it("limits authored scheduled reporting tools to delivery or resuming its own run", async () => {
    expect(await authoredCapabilities("scheduled-result")).toEqual([
      "request_vault_setup",
      "schedules-answer",
      "send_message",
    ]);
  });
});

async function authoredCapabilities(authenticator: string) {
  const context = dynamicContext(authenticator);
  const capabilities: string[] = [];

  const resolvedSingletons = await Promise.all(
    singletonTools.map(async ([name, definition]) => {
      const resolve = definition.events["turn.started"];
      return resolve && (await resolve({}, context)) ? name : null;
    })
  );
  capabilities.push(...resolvedSingletons.filter((name) => name !== null));

  const resolvedGroups = await Promise.all(
    groupedTools.map(async (definition) => {
      const resolve = definition.events["turn.started"];
      const resolved = resolve ? await resolve({}, context) : null;
      return resolved && !("execute" in resolved) ? Object.keys(resolved) : [];
    })
  );
  capabilities.push(...resolvedGroups.flat());

  const resolveWorker = worker.events["turn.started"];
  if (resolveWorker && (await resolveWorker({}, context))) {
    capabilities.push("worker");
  }

  return capabilities.toSorted();
}

function dynamicContext(authenticator: string) {
  return {
    channel: { kind: "channel:linq", metadata: {} },
    messages: [],
    session: {
      auth: {
        current: {
          attributes: {},
          authenticator,
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
    },
  } satisfies DynamicResolveContext;
}
