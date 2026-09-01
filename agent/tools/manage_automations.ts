import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  createAutomation,
  listAutomations,
  setAutomationStatus,
} from "@/db/services/automations";
import { env } from "@/env";
import { withGoogleAuth } from "@/agent/lib/google-workspace/client";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { createAutomationRequestHeaders } from "@/lib/automation-auth";
import { internalApplicationOrigin } from "@/lib/application-origin";
import { assertTimezone, automationTriggerSchema } from "@/lib/automation";
import { isE164PhoneNumber } from "@/auth/phone-number";

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    task: z.string().min(1).max(10_000),
    timezone: z.string().min(1).default("America/New_York"),
    title: z.string().min(1).max(200),
    trigger: automationTriggerSchema,
  }),
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.enum(["pause", "resume", "delete"]),
    automationId: z.string().min(1),
  }),
]);

export default defineTool({
  approval: ({ toolInput }) =>
    toolInput?.action === "delete" ? "user-approval" : "not-applicable",
  description:
    "Create and manage durable push automations. Timers sleep until an exact time without polling. Recurring and interval triggers schedule their next run after each delivery. Gmail triggers use authenticated Gmail push notifications and can match a sender, thread, or subject text. Every trigger runs the saved task with fresh data and texts the result to the authenticated user. Use list before changing an automation when its id is unknown. Deletion requires approval.",
  inputSchema,
  async execute(input, ctx) {
    const principal = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (principal?.principalType !== "user") {
      throw new Error("Automations require an authenticated user.");
    }
    if (principal.authenticator === "automation" && input.action !== "list") {
      throw new Error(
        "Automation runs cannot change the automation control plane."
      );
    }
    const scope = scopeFromPrincipal(principal);

    if (input.action === "list") {
      return { automations: await listAutomations(scope) };
    }
    if (input.action !== "create") {
      const status =
        input.action === "pause"
          ? "paused"
          : input.action === "resume"
            ? "active"
            : "deleted";
      const automation = await setAutomationStatus(
        scope,
        input.automationId,
        status
      );
      if (!automation) throw new Error("Automation not found.");
      const armed =
        status === "active" ? await armAutomation(automation) : undefined;
      return { armed, automation };
    }

    assertTimezone(input.timezone);
    if (
      input.trigger.kind === "gmail" &&
      !input.trigger.fromAddress &&
      !input.trigger.subjectContains &&
      !input.trigger.threadId
    ) {
      throw new Error("A Gmail automation needs at least one message filter.");
    }
    if (input.trigger.kind === "gmail") {
      if (
        !env.GMAIL_PUBSUB_AUDIENCE ||
        !env.GMAIL_PUBSUB_SERVICE_ACCOUNT ||
        !env.GMAIL_PUBSUB_TOPIC
      ) {
        throw new Error(
          "Gmail push automations are not configured on this deployment."
        );
      }
      await withGoogleAuth(ctx, async () => undefined);
    }
    const phoneNumber = z
      .string()
      .refine(isE164PhoneNumber)
      .parse(principal.attributes.phoneNumber);
    const automation = await createAutomation(scope, {
      idempotencyKey: `${ctx.session.id}:${ctx.callId}`,
      phoneNumber,
      sessionId: ctx.session.id,
      task: input.task,
      timezone: input.timezone,
      title: input.title,
      trigger: input.trigger,
    });
    return { armed: await armAutomation(automation), automation };
  },
});

async function armAutomation(automation: {
  readonly id: string;
  readonly revision: number;
}) {
  const headers = await createAutomationRequestHeaders({
    automationId: automation.id,
    purpose: "arm",
    revision: automation.revision,
  });
  const response = await fetch(
    `${internalApplicationOrigin()}/api/automations/arm`,
    {
      headers,
      method: "POST",
      redirect: "error",
    }
  );
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `Automation was saved but could not be armed (HTTP ${String(response.status)}): ${JSON.stringify(body)}`
    );
  }
  return body;
}
