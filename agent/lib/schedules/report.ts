import type { AttachSessionFn } from "eve/channels";
import type { ScheduleToFn } from "eve/schedules";
import {
  claimScheduledReport,
  finalizeScheduledReport,
  releaseScheduledReport,
} from "@/db/services/scheduled-agent-jobs";
import { proactionReportTurnPrompt } from "@/agent/lib/proactions/dispatch";
import { isInboxOnlyConversation } from "@/agent/lib/proactions/reconcile";
import linq from "../../channels/linq";

export async function dispatchScheduledReport(
  delivery: {
    readonly attachSession?: AttachSessionFn;
    readonly to: ScheduleToFn;
  },
  runId: string
) {
  const claimed = await claimScheduledReport(runId);
  const leaseToken = claimed?.run.reportLeaseToken;
  if (!claimed || !leaseToken) return;
  console.info("[scheduled-run] dispatching report", {
    channel: claimed.job.conversationChannel,
    reportSequence: claimed.run.reportSequence,
    runId: claimed.run.id,
    runStatus: claimed.run.status,
  });
  if (
    claimed.job.proactionId &&
    isInboxOnlyConversation(claimed.job.conversationId)
  ) {
    // No home conversation yet: findings stay in the web inbox.
    await finalizeScheduledReport(claimed.run.id, leaseToken, "suppressed");
    console.info("[scheduled-run] proaction report kept in inbox", {
      proactionId: claimed.job.proactionId,
      runId: claimed.run.id,
    });
    return;
  }
  const proaction = claimed.job.proactionId
    ? { proactionId: claimed.job.proactionId }
    : undefined;
  const reportAttributes = {
    conversationChannel: claimed.job.conversationChannel,
    conversationId: claimed.job.conversationId,
    scheduleId: claimed.job.id,
    scheduledReportLeaseToken: leaseToken,
    scheduledReportSequence: String(claimed.run.reportSequence),
    scheduledRunId: claimed.run.id,
    workspaceId: claimed.job.workspaceId,
    ...proaction,
  };
  const attributes = claimed.run.workerSessionId
    ? {
        ...reportAttributes,
        scheduledRunSessionId: claimed.run.workerSessionId,
      }
    : reportAttributes;
  const options = {
    auth: {
      attributes,
      authenticator: "scheduled-result",
      issuer: "open-instinct",
      principalId: claimed.job.createdByUserId,
      principalType: "user" as const,
    },
    turnPolicy: "queue" as const,
  };
  try {
    const prompt = await scheduledReportPrompt(claimed);
    if (claimed.job.conversationChannel === "linq") {
      const session = await delivery
        .to(linq, {
          adapterName: "linq",
          threadId: claimed.job.conversationId,
        })
        .send(prompt, options);
      console.info("[scheduled-run] report session accepted", {
        channel: claimed.job.conversationChannel,
        reportSequence: claimed.run.reportSequence,
        runId: claimed.run.id,
        sessionId: session.id,
      });
      return;
    }
    if (!delivery.attachSession) {
      throw new Error("Eve debug reports require an active session handle.");
    }
    const result = await delivery
      .attachSession(claimed.job.conversationId)
      .send(prompt, options);
    if (result.status === "session_not_active") {
      await finalizeScheduledReport(claimed.run.id, leaseToken, "suppressed");
    }
    console.info("[scheduled-run] report turn accepted", {
      channel: claimed.job.conversationChannel,
      reportSequence: claimed.run.reportSequence,
      resultStatus: result.status,
      runId: claimed.run.id,
    });
  } catch (error) {
    const released = await releaseScheduledReport(
      claimed.run.id,
      leaseToken,
      error instanceof Error ? error.message : String(error)
    );
    console.warn("[scheduled-run] report dispatch failed", {
      cause: error,
      released,
      reportSequence: claimed.run.reportSequence,
      runId: claimed.run.id,
    });
  }
}

async function scheduledReportPrompt(
  claimed: NonNullable<Awaited<ReturnType<typeof claimScheduledReport>>>
) {
  if (
    claimed.job.proactionId &&
    !claimed.run.pendingInputRequests &&
    claimed.run.status === "completed"
  ) {
    const prompt = await proactionReportTurnPrompt(claimed);
    if (prompt) return prompt;
  }
  if (claimed.run.pendingInputRequests) {
    return [
      "A background scheduled run is waiting for the user before it can continue.",
      `Original task: ${claimed.job.prompt}`,
      `Scheduled for: ${claimed.run.scheduledFor.toISOString()}`,
      `Internal run ID: ${claimed.run.id}`,
      `Pending request: ${JSON.stringify(claimed.run.pendingInputRequests)}`,
      "First check whether the existing conversation clearly answers the request. If it does, call schedules-answer now. Otherwise ask the user clearly, keeping the internal run ID out of the user-visible message so schedules-answer can resume this run after they reply.",
    ].join("\n\n");
  }
  if (!claimed.run.outcome) {
    throw new Error("A completed scheduled run requires an outcome.");
  }
  return [
    "A background scheduled run has completed.",
    `Original task: ${claimed.job.prompt}`,
    `Scheduled for: ${claimed.run.scheduledFor.toISOString()}`,
    `Worker outcome: ${JSON.stringify(claimed.run.outcome)}`,
  ].join("\n\n");
}
