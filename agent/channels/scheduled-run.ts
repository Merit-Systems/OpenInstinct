import { defineChannel, POST } from "eve/channels";
import { localDev, routeAuth, vercelOidc } from "eve/channels/auth";
import { parseInputResponses, resolveTextToResponses } from "eve/client";
import { z } from "zod";
import { scheduledRunOutcomeJsonSchema } from "@/agent/lib/schedules/outcome";
import { dispatchScheduledReport } from "@/agent/lib/schedules/report";
import {
  claimScheduledAgentRunInput,
  finishScheduledAgentRunInput,
  getClaimedScheduledAgentRun,
  restoreScheduledAgentRunInput,
  setScheduledRunSession,
} from "@/db/services/scheduled-agent-jobs";

const startSchema = z.strictObject({
  leaseToken: z.uuid(),
  restart: z.boolean().optional(),
  runId: z.uuid(),
});
const reportSchema = z.strictObject({ runId: z.uuid() });
const respondSchema = z.strictObject({
  answer: z.string().trim().min(1).max(8_000),
  leaseToken: z.uuid(),
  runId: z.uuid(),
});
const internalRouteAuth = [vercelOidc(), localDev()];

export default defineChannel({
  routes: [
    POST("/internal/scheduled-run/start", async (request, { from }) => {
      const auth = await routeAuth(request, internalRouteAuth);
      if (auth instanceof Response) return auth;
      const input = startSchema.parse(await request.json());
      const claimed = await getClaimedScheduledAgentRun(
        input.runId,
        input.leaseToken
      );
      if (!claimed) return new Response(null, { status: 409 });
      const source = from(`scheduled-run:${input.runId}`);
      if (input.restart) {
        await source.reset({
          reason: "Scheduled worker exceeded its runtime.",
        });
      }
      const session = await source.send(scheduledRunPrompt(claimed), {
        auth: scheduledWorkerAuth(claimed),
        outputSchema: scheduledRunOutcomeJsonSchema,
        title: `Scheduled run ${input.runId}`,
      });
      await setScheduledRunSession(input.runId, input.leaseToken, session.id);
      return Response.json({ sessionId: session.id });
    }),
    POST(
      "/internal/scheduled-run/report",
      async (request, { attachSession, to, waitUntil }) => {
        const auth = await routeAuth(request, internalRouteAuth);
        if (auth instanceof Response) return auth;
        const parsed = reportSchema.safeParse(await request.json());
        if (parsed.success) {
          waitUntil(
            dispatchScheduledReport({ attachSession, to }, parsed.data.runId)
          );
        }
        return new Response(null, { status: 202 });
      }
    ),
    POST(
      "/internal/scheduled-run/respond",
      async (request, { attachSession }) => {
        const auth = await routeAuth(request, internalRouteAuth);
        if (auth instanceof Response) return auth;
        const input = respondSchema.parse(await request.json());
        const claimed = await claimScheduledAgentRunInput(
          input.runId,
          input.leaseToken
        );
        if (
          !claimed?.run.pendingInputRequests ||
          !claimed.run.workerSessionId
        ) {
          return new Response(null, { status: 409 });
        }
        const responses = parseInputResponses(
          resolveTextToResponses(input.answer, claimed.run.pendingInputRequests)
        );
        if (responses.length === 0) {
          await restoreScheduledAgentRunInput(
            input.runId,
            input.leaseToken,
            "The answer did not match the pending request."
          );
          return new Response(null, { status: 422 });
        }
        try {
          const result = await attachSession(
            claimed.run.workerSessionId
          ).respond(responses, {
            auth: {
              attributes: {
                conversationChannel: claimed.job.conversationChannel,
                conversationId: claimed.job.conversationId,
                scheduleId: claimed.job.id,
                scheduledRunId: claimed.run.id,
                workspaceId: claimed.job.workspaceId,
              },
              authenticator: "scheduled-input",
              issuer: "open-instinct",
              principalId: claimed.job.createdByUserId,
              principalType: "user",
            },
          });
          if (result.status !== "accepted") {
            await restoreScheduledAgentRunInput(
              input.runId,
              input.leaseToken,
              "The scheduled session is no longer active."
            );
            return new Response(null, { status: 409 });
          }
          await finishScheduledAgentRunInput(input.runId, input.leaseToken);
          return new Response(null, { status: 202 });
        } catch (error) {
          await restoreScheduledAgentRunInput(
            input.runId,
            input.leaseToken,
            error instanceof Error ? error.message : String(error)
          );
          return new Response(null, { status: 502 });
        }
      }
    ),
  ],
});

function scheduledRunPrompt(
  claim: NonNullable<Awaited<ReturnType<typeof getClaimedScheduledAgentRun>>>
) {
  return [
    "Complete this user-owned scheduled task in an isolated background session.",
    `Scheduled for: ${claim.run.scheduledFor.toISOString()}`,
    `Task: ${claim.job.prompt}`,
    "Return exactly one structured final outcome.",
  ].join("\n\n");
}

function scheduledWorkerAuth(
  claim: NonNullable<Awaited<ReturnType<typeof getClaimedScheduledAgentRun>>>
) {
  const leaseToken = claim.run.leaseToken;
  if (!leaseToken) throw new Error("A scheduled run claim requires a lease.");
  return {
    attributes: {
      conversationChannel: claim.job.conversationChannel,
      conversationId: claim.job.conversationId,
      scheduleId: claim.job.id,
      scheduledRunLeaseToken: leaseToken,
      scheduledRunId: claim.run.id,
      workspaceId: claim.job.workspaceId,
    },
    authenticator: "scheduled-worker",
    issuer: "open-instinct",
    principalId: claim.job.createdByUserId,
    principalType: "user" as const,
  };
}
