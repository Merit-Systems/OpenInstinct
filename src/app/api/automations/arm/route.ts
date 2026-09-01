import { start } from "workflow/api";
import {
  prepareGmailWatch,
  readAutomationById,
  recordGmailWatchWorkflow,
} from "@/db/services/automations";
import { verifyAutomationRequest } from "@/lib/automation-auth";
import { ensureApplicationWorkflowWorld } from "../_lib/workflow-world";
import {
  gmailWatchWorkflow,
  timerAutomationWorkflow,
} from "../_workflows/automations";

export async function POST(request: Request) {
  const signed = await verifyAutomationRequest(request.headers, "arm");
  if (!signed) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureApplicationWorkflowWorld();
  const automation = await readAutomationById(signed.automationId);
  if (
    automation?.status !== "active" ||
    automation.revision !== signed.revision
  ) {
    return Response.json({ error: "Automation is inactive" }, { status: 409 });
  }

  if (automation.trigger.kind === "gmail") {
    const scope = {
      userId: automation.createdByUserId,
      workspaceId: automation.workspaceId,
    };
    const prepared = await prepareGmailWatch(scope);
    if (!prepared.startRequired) {
      return Response.json({ kind: "gmail", status: "already-armed" });
    }
    const run = await start(
      gmailWatchWorkflow,
      [{ ...scope, generation: prepared.generation }],
      {
        attributes: {
          automationId: automation.id,
          trigger: "gmail-watch",
          userId: automation.createdByUserId,
        },
        deploymentId: "latest",
      }
    );
    await recordGmailWatchWorkflow(scope, prepared.generation, run.runId);
    return Response.json({ kind: "gmail", runId: run.runId, status: "armed" });
  }

  if (!automation.nextRunAt) {
    return Response.json(
      { error: "Automation has no next run" },
      { status: 409 }
    );
  }
  const run = await start(
    timerAutomationWorkflow,
    [
      {
        automationId: automation.id,
        revision: automation.revision,
        runAt: automation.nextRunAt,
      },
    ],
    {
      attributes: {
        automationId: automation.id,
        trigger: automation.trigger.kind,
      },
      deploymentId: "latest",
    }
  );
  return Response.json({
    kind: automation.trigger.kind,
    runId: run.runId,
    status: "armed",
  });
}
