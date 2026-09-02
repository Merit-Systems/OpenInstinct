import type { DynamicResolveContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import worker from "@/agent/subagents/worker/agent";
import calendarCheckAvailabilityDefinition from "@/agent/tools/calendar/check-availability";
import calendarCreateEventDefinition from "@/agent/tools/calendar/create-event";
import calendarListEventsDefinition from "@/agent/tools/calendar/list-events";
import contactsSearchDefinition from "@/agent/tools/contacts/search";
import gmailReadThreadDefinition from "@/agent/tools/gmail/read-thread";
import gmailSearchDefinition from "@/agent/tools/gmail/search";
import gmailSendDefinition from "@/agent/tools/gmail/send";
import gmailUpdateDefinition from "@/agent/tools/gmail/update";
import messaging from "@/agent/tools/messaging";
import requestVaultImport from "@/agent/tools/request_vault_import";
import requestVaultSetup from "@/agent/tools/request_vault_setup";
import restaurantAvailabilityDefinition from "@/agent/tools/restaurants/availability";
import answerSchedule from "@/agent/tools/schedules/answer";
import createScheduleDefinition from "@/agent/tools/schedules/create";
import listSchedulesDefinition from "@/agent/tools/schedules/list";
import updateScheduleDefinition from "@/agent/tools/schedules/update";
import updateUserProfile from "@/agent/tools/update_user_profile";

const singletonTools = [
  ["calendar-check-availability", calendarCheckAvailabilityDefinition],
  ["calendar-create-event", calendarCreateEventDefinition],
  ["calendar-list-events", calendarListEventsDefinition],
  ["contacts-search", contactsSearchDefinition],
  ["gmail-read-thread", gmailReadThreadDefinition],
  ["gmail-search", gmailSearchDefinition],
  ["gmail-send", gmailSendDefinition],
  ["gmail-update", gmailUpdateDefinition],
  ["request_vault_import", requestVaultImport],
  ["request_vault_setup", requestVaultSetup],
  ["restaurants-availability", restaurantAvailabilityDefinition],
  ["schedules-answer", answerSchedule],
  ["schedules-create", createScheduleDefinition],
  ["schedules-list", listSchedulesDefinition],
  ["schedules-update", updateScheduleDefinition],
  ["update_user_profile", updateUserProfile],
] as const;

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
      "restaurants-availability",
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
      "restaurants-availability",
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

  const resolveMessaging = messaging.events["turn.started"];
  const resolvedMessaging = resolveMessaging
    ? await resolveMessaging({}, context)
    : null;
  if (resolvedMessaging && !("execute" in resolvedMessaging)) {
    capabilities.push(...Object.keys(resolvedMessaging));
  }

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
