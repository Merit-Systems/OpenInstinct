import {
  sleep,
  FatalError,
  RetryableError,
  getStepMetadata,
  getWorkflowMetadata,
} from "workflow";
import { start, getRun } from "workflow/api";
import {
  claimScheduledWakeup,
  recordScheduledWakeup,
  releaseScheduledWakeup,
} from "@db/services/scheduled-wakeup-registrations";
import { postScheduledRunRoute } from "@db/services/auth/scheduled-requests";
import {
  scheduledResponseSchema,
  type ScheduledCommand,
  type ScheduledWakeup,
} from "@shared/schedules/wakeups";

export async function scheduledCommandWorkflow(
  command: ScheduledCommand,
  origin: string
) {
  "use workflow";
  let response = await commandStep(command, origin);
  await armWakeups(response.wakeups, origin);
  // oxlint-disable eslint/no-await-in-loop -- Each page depends on the previous durable cursor.
  while (command.kind === "backfill" && response.result.cursor) {
    response = await commandStep(
      { kind: "backfill", cursor: response.result.cursor },
      origin
    );
    await armWakeups(response.wakeups, origin);
  }
  // oxlint-enable eslint/no-await-in-loop
  return response;
}

export async function scheduledWakeupWorkflow(
  wakeup: ScheduledWakeup,
  origin: string
) {
  "use workflow";
  try {
    await sleep(new Date(wakeup.at));
    const response = await wakeStep(wakeup, origin);
    await armWakeups(response.wakeups, origin);
  } catch (error) {
    await releaseWakeupStep(wakeup, getWorkflowMetadata().workflowRunId);
    throw error;
  }
}

async function armWakeups(wakeups: ScheduledWakeup[], origin: string) {
  "use workflow";
  await Promise.all(wakeups.map((wakeup) => armWakeupStep(wakeup, origin)));
}

async function armWakeupStep(wakeup: ScheduledWakeup, origin: string) {
  "use step";
  const owner = getStepMetadata().stepId;
  const registration = await claimScheduledWakeup(wakeup, owner);
  if (!registration.claimed) {
    if (!registration.workflowRunId)
      throw new RetryableError("Another workflow is registering this wakeup.", {
        retryAfter: "30s",
      });
    const existing = getRun(registration.workflowRunId);
    const status = await existing.status;
    if (status === "failed" || status === "cancelled") {
      await releaseScheduledWakeup(wakeup, registration.workflowRunId);
      throw new RetryableError("Rearming an interrupted scheduled wakeup.", {
        retryAfter: "1s",
      });
    }
    // Resume only persisted timers whose due time has passed.
    if (status === "running" && new Date(wakeup.at).getTime() <= Date.now())
      await existing.wakeUp();
    return;
  }
  const run = await start(scheduledWakeupWorkflow, [wakeup, origin], {
    deploymentId: "latest",
  });
  if (!(await recordScheduledWakeup(registration.key, owner, run.runId)))
    throw new RetryableError(
      "Wakeup registration changed before confirmation.",
      { retryAfter: "1s" }
    );
}
armWakeupStep.maxRetries = 20;

async function commandStep(command: ScheduledCommand, origin: string) {
  "use step";
  return readResponse(
    await postScheduledRunRoute(
      "/internal/scheduled-run/command",
      command,
      origin
    )
  );
}
commandStep.maxRetries = 20;

async function wakeStep(wakeup: ScheduledWakeup, origin: string) {
  "use step";
  return readResponse(
    await postScheduledRunRoute("/internal/scheduled-run/wake", wakeup, origin)
  );
}
wakeStep.maxRetries = 20;

async function readResponse(response: Response) {
  if (!response.ok) {
    const message =
      "Scheduled callback failed (" + String(response.status) + ").";
    if (response.status >= 500 || response.status === 429)
      throw new RetryableError(message, { retryAfter: "30s" });
    throw new FatalError(message);
  }
  return scheduledResponseSchema.parse(await response.json());
}

async function releaseWakeupStep(
  wakeup: ScheduledWakeup,
  workflowRunId: string
) {
  "use step";
  await releaseScheduledWakeup(wakeup, workflowRunId);
}
