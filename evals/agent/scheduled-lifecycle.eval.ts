import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import { sendMessageOutputSchema } from "@/agent/lib/send-message";
import { agentEvalTags } from "@/evals/agent/shared";
import { accessScopeForUser } from "@/lib/access-scope";

const resultCanary = "SCHEDULE_LIFECYCLE_CANARY";

export default defineEval({
  description:
    "Executes a due scheduled task and reports it to its conversation",
  tags: [...agentEvalTags, "schedules", "lifecycle"],
  timeoutMs: 180_000,
  async test(t) {
    const initial = await t.send(
      "Reply with exactly 'Schedule lifecycle harness ready.'"
    );
    initial.expectOk();
    initial.succeeded();

    const { createScheduledAgentJob, listScheduledAgentJobs } =
      await import("@/db/services/scheduled-agent-jobs");
    const dueAt = new Date(Date.now() - 1_000);
    const scope = accessScopeForUser("better-auth:browser-benchmark");
    const conversation = {
      conversationChannel: "eve" as const,
      conversationId: initial.sessionId,
    };
    const job = await createScheduledAgentJob(
      scope,
      {
        ...conversation,
        missedRunPolicy: "run_latest",
        prompt: `Return exactly this final structured outcome without calling tools: {"kind":"result","summary":"${resultCanary}","urgency":"normal"}`,
        timing: { at: dueAt.toISOString(), kind: "once" },
      },
      new Date(dueAt.getTime() - 1_000)
    );

    const dispatch = await t.target.dispatchSchedule("dynamic");
    const sessionIds = await t.require(
      dispatch.sessionIds,
      satisfies<readonly string[]>(
        (ids) => ids.length === 1,
        "one due scheduled worker session was dispatched"
      )
    );
    const workerSessionId = sessionIds[0];
    if (!workerSessionId) {
      throw new Error("Schedule dispatch did not return a worker session.");
    }

    const worker = await t.target.attachSession(workerSessionId);
    worker.succeeded();
    worker.outputEquals({
      kind: "result",
      summary: resultCanary,
      urgency: "normal",
    });

    const stored = (await listScheduledAgentJobs(scope, conversation)).find(
      (candidate) => candidate.id === job.id
    );
    const runId = await t.require(
      stored?.latestRun?.id,
      satisfies<string | undefined>(
        (value) => value !== undefined,
        "the scheduled worker persisted a run"
      )
    );
    if (!runId) throw new Error("The scheduled run was not persisted.");

    const reportResponse = await t.target.fetch(
      "/internal/scheduled-run/report",
      {
        body: JSON.stringify({ runId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    await t.require(reportResponse.status, equals(202));

    const report = await t.target.attachSession(initial.sessionId, {
      startIndex: initial.events.length,
    });
    report.succeeded();
    report.calledTool("send_message", {
      input: (input) => {
        const parsed = sendMessageOutputSchema.safeParse(input);
        return (
          parsed.success &&
          parsed.data.kind === "message" &&
          parsed.data.text?.includes(resultCanary) === true
        );
      },
      status: "completed",
      count: 1,
    });
    report.notCalledTool("worker");
  },
});
