import { auth, gmail } from "@googleapis/gmail";
import { getTokenResponse } from "@vercel/connect";
import type { MessageStreamEvent } from "eve/client";
import { createLogger, parseError } from "evlog";
import { sleep } from "workflow";
import { start } from "workflow/api";
import { z } from "zod";
import {
  activateGmailWatch,
  advanceGmailHistory,
  beginAutomationRun,
  finishAutomationRun,
  listActiveGmailAutomations,
  prepareGmailWatch,
  readGmailWatchByEmail,
  recordAutomationEveSession,
} from "@/db/services/automations";
import { env } from "@/env";
import type { AccessScope } from "@/lib/access-scope";
import { createAutomationRequestHeaders } from "@/lib/automation-auth";
import { internalApplicationOrigin } from "@/lib/application-origin";
import { gmailTriggerMatches } from "@/lib/automation";
import { googleWorkspaceTokenParams } from "@/lib/google-workspace";
import { sendLinqText } from "@/auth/linq";

interface TimerAutomationWorkflowInput {
  readonly automationId: string;
  readonly revision: number;
  readonly runAt: string;
}

interface GmailWatchWorkflowInput extends AccessScope {
  readonly generation: number;
}

export interface GmailEventWorkflowInput {
  readonly emailAddress: string;
  readonly historyId: string;
  readonly messageId: string;
}

interface GmailEventMatch {
  readonly automationId: string;
  readonly eventContext: string;
  readonly revision: number;
  readonly triggerKey: string;
}

const eveSessionAcceptedSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string().min(1),
  status: z.literal("accepted"),
});

export async function timerAutomationWorkflow(
  input: TimerAutomationWorkflowInput
) {
  "use workflow";

  await sleep(new Date(input.runAt));
  const run = await beginAutomationStep(
    input.automationId,
    input.revision,
    `timer:${input.runAt}`
  );
  if (!run) return { outcome: "suppressed" } as const;

  const completed = await executeAndDeliverAutomation(run);
  if (
    completed.status === "active" &&
    completed.nextRunAt &&
    completed.revision === input.revision
  ) {
    await start(
      timerAutomationWorkflow,
      [
        {
          automationId: completed.id,
          revision: completed.revision,
          runAt: completed.nextRunAt,
        },
      ],
      { deploymentId: "latest" }
    );
  }
  return {
    nextRunAt: completed.nextRunAt,
    outcome: completed.status,
  } as const;
}

export async function gmailWatchWorkflow(input: GmailWatchWorkflowInput) {
  "use workflow";

  const watch = await createGmailWatchStep(input);
  if (!watch) return { outcome: "superseded" } as const;
  await sleep(new Date(watch.renewAt));
  const renewal = await prepareGmailWatchStep(input);
  if (!renewal.startRequired) return { outcome: "already-renewed" } as const;
  await start(
    gmailWatchWorkflow,
    [{ ...input, generation: renewal.generation }],
    { deploymentId: "latest" }
  );
  return { outcome: "renewed" } as const;
}

export async function gmailEventWorkflow(input: GmailEventWorkflowInput) {
  "use workflow";

  const batch = await loadGmailEventMatchesStep(input);
  /* oxlint-disable eslint/no-await-in-loop -- Each matching delivery is serialized so one user's shared Eve session sees an ordered queue. */
  for (const match of batch.matches) {
    const run = await beginAutomationStep(
      match.automationId,
      match.revision,
      match.triggerKey
    );
    if (run) await executeAndDeliverAutomation(run, match.eventContext);
  }
  /* oxlint-enable eslint/no-await-in-loop */
  await advanceGmailHistoryStep(
    batch.workspaceId,
    batch.userId,
    batch.historyId
  );
  return { matchCount: batch.matches.length, outcome: "processed" } as const;
}

async function executeAndDeliverAutomation(
  run: Awaited<ReturnType<typeof beginAutomationStep>> & {},
  eventContext?: string
) {
  "use workflow";

  try {
    const eveSessionId = await startAutomationExecutionStep(run, eventContext);
    const execution = await collectAutomationExecutionStep(run, eveSessionId);
    await retireAutomationExecutionStep(run, eveSessionId);
    if (execution.status !== "completed") {
      return await finishAutomationStep(run.runId, {
        error:
          execution.status === "waiting"
            ? "Automation requires human input and cannot continue unattended."
            : (execution.error ?? "Automation Eve task failed."),
      });
    }
    if (!execution.message) {
      return await finishAutomationStep(run.runId, {
        error: "Automation agent completed without a deliverable message.",
      });
    }
    await deliverAutomationStep(run, execution.message);
    return await finishAutomationStep(run.runId, {
      result: execution.message,
    });
  } catch (error) {
    return await finishAutomationStep(run.runId, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function beginAutomationStep(
  automationId: string,
  revision: number,
  triggerKey: string
) {
  "use step";
  return beginAutomationRun(automationId, revision, triggerKey);
}

async function startAutomationExecutionStep(
  run: NonNullable<Awaited<ReturnType<typeof beginAutomationStep>>>,
  eventContext?: string
) {
  "use step";
  const log = automationLogger("dispatch", run, { eventContext });
  try {
    const { Client } = await import("eve/client");
    const client = new Client({
      headers: () => automationExecutionHeaders(run),
      host: internalApplicationOrigin(),
      redirect: "error",
    });
    const response = await client.fetch("/eve/v1/session", {
      body: JSON.stringify({
        context: [
          JSON.stringify({
            automationId: run.automation.id,
            automationRunId: run.runId,
            automationTitle: run.automation.title,
          }),
        ],
        message: automationPrompt(run.automation.task, eventContext),
        mode: "conversation",
        operationId: `automation-run:${run.runId}`,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(
        `Automation Eve task dispatch failed with HTTP ${String(response.status)}: ${JSON.stringify(body)}`
      );
    }
    const accepted = eveSessionAcceptedSchema.parse(body);
    await recordAutomationEveSession(run.runId, accepted.sessionId);
    log.set({ eveResponse: accepted });
    log.info("Automation Eve task dispatched");
    return accepted.sessionId;
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      failure: parseError(error),
    });
    throw error;
  } finally {
    log.emit();
  }
}

async function collectAutomationExecutionStep(
  run: NonNullable<Awaited<ReturnType<typeof beginAutomationStep>>>,
  eveSessionId: string
) {
  "use step";
  const log = automationLogger("execute", run, { eveSessionId });
  const events: MessageStreamEvent[] = [];
  let error: string | undefined;
  let inputRequired = false;
  let message: string | undefined;
  let status: "completed" | "failed" | "waiting" | undefined;
  try {
    const { Client } = await import("eve/client");
    const client = new Client({
      headers: () => automationExecutionHeaders(run),
      host: internalApplicationOrigin(),
      redirect: "error",
    });
    const session = client.sessions.attach(eveSessionId);
    for await (const event of session.stream({ startIndex: 0 })) {
      events.push(event);
      if (
        event.type === "input.requested" ||
        event.type === "authorization.required"
      ) {
        inputRequired = true;
      } else if (
        event.type === "message.completed" &&
        event.data.finishReason !== "tool-calls"
      ) {
        message = event.data.message?.trim() ?? undefined;
      } else if (event.type === "session.failed") {
        error = `${event.data.code}: ${event.data.message}`;
        status = "failed";
        break;
      } else if (event.type === "session.waiting") {
        status = inputRequired ? "waiting" : "completed";
        break;
      } else if (event.type === "session.completed") {
        status = "completed";
        break;
      }
    }
    if (!status) throw new Error("Automation Eve task stream ended early.");
    log.set({
      eveEvents: events,
      eveSessionId,
      response: { error, message, status },
    });
    log.info("Automation Eve task settled");
    return { error, message, status };
  } catch (caught) {
    log.error(caught instanceof Error ? caught : String(caught), {
      eveEvents: events,
      failure: parseError(caught),
    });
    throw caught;
  } finally {
    log.emit();
  }
}

async function retireAutomationExecutionStep(
  run: NonNullable<Awaited<ReturnType<typeof beginAutomationStep>>>,
  eveSessionId: string
) {
  "use step";
  const { Client } = await import("eve/client");
  const client = new Client({
    headers: () => automationExecutionHeaders(run),
    host: internalApplicationOrigin(),
    redirect: "error",
  });
  await client.sessions.attach(eveSessionId).reset({
    reason: "Automation run settled.",
  });
}

async function deliverAutomationStep(
  run: NonNullable<Awaited<ReturnType<typeof beginAutomationStep>>>,
  result: string
) {
  "use step";
  const log = automationLogger("deliver", run, { result });
  try {
    if (!env.LINQ_CONNECTOR) {
      throw new Error("LINQ_CONNECTOR is required for automation delivery.");
    }
    await sendLinqText({
      connector: env.LINQ_CONNECTOR,
      idempotencyKey: `automation-run:${run.runId}`,
      message: result,
      to: run.automation.phoneNumber,
    });
    log.info("Automation text delivered");
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      failure: parseError(error),
    });
    throw error;
  } finally {
    log.emit();
  }
}

async function finishAutomationStep(
  runId: string,
  outcome: { readonly error?: string; readonly result?: string }
) {
  "use step";
  return finishAutomationRun({ runId, ...outcome });
}

async function prepareGmailWatchStep(scope: GmailWatchWorkflowInput) {
  "use step";
  return prepareGmailWatch(scope);
}

async function createGmailWatchStep(input: GmailWatchWorkflowInput) {
  "use step";
  const log = createLogger({ gmailWatch: input, operation: "gmail.watch" });
  try {
    if (!env.GMAIL_PUBSUB_TOPIC) {
      throw new Error("GMAIL_PUBSUB_TOPIC is required for Gmail automations.");
    }
    const client = await gmailClient(input.userId);
    const [{ data: profile }, { data: watch }] = await Promise.all([
      client.users.getProfile({ userId: "me" }),
      client.users.watch({
        requestBody: {
          labelFilterBehavior: "include",
          labelIds: ["INBOX"],
          topicName: env.GMAIL_PUBSUB_TOPIC,
        },
        userId: "me",
      }),
    ]);
    if (!profile.emailAddress || !watch.expiration || !watch.historyId) {
      throw new Error("Gmail returned an incomplete watch response.");
    }
    const expirationAt = new Date(Number(watch.expiration));
    const activated = await activateGmailWatch({
      emailAddress: profile.emailAddress,
      expirationAt: expirationAt.toISOString(),
      generation: input.generation,
      historyId: watch.historyId,
      scope: input,
    });
    if (!activated) return undefined;
    const renewAt = new Date(
      Math.max(
        Date.now() + 60_000,
        expirationAt.getTime() - 24 * 60 * 60 * 1000
      )
    );
    log.set({
      activated,
      gmailResponse: watch,
      renewAt: renewAt.toISOString(),
    });
    log.info("Gmail push watch activated");
    return { renewAt: renewAt.toISOString() };
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      failure: parseError(error),
    });
    throw error;
  } finally {
    log.emit();
  }
}

async function loadGmailEventMatchesStep(input: GmailEventWorkflowInput) {
  "use step";
  const log = createLogger({ gmailPush: input, operation: "gmail.event" });
  try {
    const watch = await readGmailWatchByEmail(input.emailAddress);
    if (watch?.status !== "active" || !watch.historyId) {
      throw new Error(
        `No active Gmail watch exists for ${input.emailAddress}.`
      );
    }
    if (BigInt(input.historyId) <= BigInt(watch.historyId)) {
      return {
        historyId: input.historyId,
        matches: [],
        userId: watch.userId,
        workspaceId: watch.workspaceId,
      };
    }

    const client = await gmailClient(watch.userId);
    const messageIds = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = input.historyId;
    /* oxlint-disable eslint/no-await-in-loop -- Gmail history page tokens form an ordered cursor chain. */
    do {
      const { data } = await client.users.history.list({
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
        pageToken,
        startHistoryId: watch.historyId,
        userId: "me",
      });
      for (const history of data.history ?? []) {
        for (const addition of history.messagesAdded ?? []) {
          const message = addition.message;
          if (message?.id && message.labelIds?.includes("INBOX")) {
            messageIds.add(message.id);
          }
        }
      }
      latestHistoryId = data.historyId ?? latestHistoryId;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    /* oxlint-enable eslint/no-await-in-loop */

    const messages = await Promise.all(
      [...messageIds].map(async (id) => {
        const { data } = await client.users.messages.get({
          format: "metadata",
          id,
          metadataHeaders: ["From", "Subject", "Date", "Message-ID"],
          userId: "me",
        });
        const headers = new Map(
          (data.payload?.headers ?? []).flatMap((header) =>
            header.name && header.value
              ? [[header.name.toLowerCase(), header.value] as const]
              : []
          )
        );
        return {
          date: headers.get("date") ?? "",
          from: headers.get("from") ?? "",
          id,
          messageId: headers.get("message-id") ?? "",
          snippet: data.snippet ?? "",
          subject: headers.get("subject") ?? "",
          threadId: data.threadId ?? "",
        };
      })
    );
    const automations = await listActiveGmailAutomations(
      watch.workspaceId,
      watch.userId
    );
    const matches = automations.flatMap((automation) => {
      if (automation.trigger.kind !== "gmail") return [];
      const trigger = automation.trigger;
      return messages.flatMap((message) =>
        gmailTriggerMatches(trigger, message)
          ? [
              {
                automationId: automation.id,
                eventContext: JSON.stringify(message),
                revision: automation.revision,
                triggerKey: `gmail:${message.id}`,
              } satisfies GmailEventMatch,
            ]
          : []
      );
    });
    log.set({ automations, matches, messages, watch });
    log.info("Gmail push event matched automations");
    return {
      historyId: latestHistoryId,
      matches,
      userId: watch.userId,
      workspaceId: watch.workspaceId,
    };
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      failure: parseError(error),
    });
    throw error;
  } finally {
    log.emit();
  }
}

async function advanceGmailHistoryStep(
  workspaceId: string,
  userId: string,
  historyId: string
) {
  "use step";
  await advanceGmailHistory(workspaceId, userId, historyId);
}

async function gmailClient(userId: string) {
  const response = await getTokenResponse(
    env.GOOGLE_CONNECTOR_UID,
    googleWorkspaceTokenParams(userId),
    { forceRefresh: true }
  );
  const authClient = new auth.OAuth2();
  authClient.setCredentials({ access_token: response.token });
  return gmail({ auth: authClient, version: "v1" });
}

function automationLogger(
  operation: string,
  run: NonNullable<Awaited<ReturnType<typeof beginAutomationStep>>>,
  context: {
    readonly eventContext?: string;
    readonly eveSessionId?: string;
    readonly result?: string;
  }
) {
  return createLogger({
    automation: run.automation,
    automationRun: {
      id: run.runId,
      startedAt: run.startedAt,
    },
    operation: `automation.${operation}`,
    ...context,
  });
}

function automationExecutionHeaders(
  run: NonNullable<Awaited<ReturnType<typeof beginAutomationStep>>>
) {
  return createAutomationRequestHeaders({
    automationId: run.automation.id,
    purpose: "execute",
    revision: run.automation.revision,
    runId: run.runId,
  });
}

function automationPrompt(task: string, eventContext?: string) {
  return [
    "Run this saved automation now.",
    `Task: ${task}`,
    eventContext ? `Trigger event:\n${eventContext}` : undefined,
    "Complete the task using current data. Do not create, update, pause, or delete automations while fulfilling it. Return a concise text message for the user.",
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n\n");
}
