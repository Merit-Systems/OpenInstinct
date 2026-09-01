import { defineEval, type EveEvalLiveTurn, type EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { reportBrowserBenchmarkActivity } from "@/evals/browser/benchmark-reporter";
import {
  didCompleteWorker,
  didFinishWorker,
  readTaskCompletion,
} from "@/lib/worker-events";
import {
  browserBenchmarkFixtureContext,
  browserBenchmarkTasks,
} from "@/evals/browser/tasks";
import { browserBenchmarkEnv } from "@/evals/browser/env";

const repetitions = browserBenchmarkEnv.BROWSER_BENCH_REPETITIONS;
const tasks = browserBenchmarkTasks(browserBenchmarkEnv.BROWSER_BENCH_SUITE);

export default tasks.flatMap((task) =>
  Array.from({ length: repetitions }, (_, repetitionIndex) => {
    const description =
      repetitions === 1
        ? task.description
        : `${task.description} [${String(repetitionIndex + 1)}/${String(repetitions)}]`;
    return defineEval({
      description,
      tags: ["browser", "benchmark"],
      async test(t) {
        const started = await t.send(task.prompt);
        started.expectOk();
        started.calledSubagent("worker", { count: 1 });
        const childSessionId = requireWorkerSessionId(started);
        let child = t.target.watchTurn(childSessionId, { startIndex: 0 });
        let turnStartIndex = 0;
        let completed: EveEvalTurn | null = null;
        const workerEvents: EveEvalTurn["events"][number][] = [];

        /* oxlint-disable eslint/no-await-in-loop -- Each watch resumes from the stream index produced by the previous worker turn. */
        for (let attempt = 0; attempt < 60; attempt += 1) {
          try {
            const turn = await resultWithLiveActivity(
              child,
              description,
              childSessionId,
              workerEvents,
              (milliseconds) => t.sleep(milliseconds)
            );
            turn.expectOk();
            workerEvents.push(...turn.events);
            if (didFinishWorker(workerEvents)) {
              completed = turn;
              break;
            }
            turnStartIndex = requireStreamIndex(child.session);
          } catch (error) {
            if (!isIdleStreamClosure(error)) throw error;
          }
          if (completed === null) {
            child = t.target.watchTurn(childSessionId, {
              startIndex: turnStartIndex,
            });
          }
        }
        /* oxlint-enable eslint/no-await-in-loop */

        await t.require(
          completed,
          satisfies(
            (turn) => turn !== null,
            "the worker emitted a native structured completion"
          )
        );
        t.check(
          didCompleteWorker(workerEvents),
          satisfies(
            (workerSucceeded) => workerSucceeded === true,
            "the worker self-reported success"
          )
        )
          .label("worker self-reported success")
          .soft();

        child.session.succeeded();
        await t.require(
          child.events.filter((event) => event.type === "result.completed")
            .length,
          satisfies(
            (count) => count === 1,
            "the worker emitted exactly one native structured result"
          )
        );
        t.succeeded();
        const workerCompletion = readTaskCompletion(child.events);
        const taskJudgeContext =
          "judgeContext" in task ? task.judgeContext : undefined;
        t.judge.autoevals
          .closedQA(
            taskCompletionCriteria(task.successCriteria, taskJudgeContext),
            {
              on: [
                `User task:\n${task.prompt}`,
                `Benchmark fixture context:\n${browserBenchmarkFixtureContext}`,
                ...(taskJudgeContext
                  ? [`Task-specific judge context:\n${taskJudgeContext}`]
                  : []),
                `Worker result:\n${workerCompletion?.message ?? "No worker result"}`,
              ].join("\n\n"),
            }
          )
          .label("task completed")
          .gate(0.8);
      },
    });
  })
);

async function resultWithLiveActivity(
  turn: EveEvalLiveTurn,
  taskName: string,
  sessionId: string,
  priorEvents: readonly EveEvalTurn["events"][number][],
  sleep: (milliseconds?: number) => Promise<void>
) {
  const result = turn.result();
  return pollForResult(result, turn, taskName, sessionId, priorEvents, sleep);
}

async function pollForResult(
  result: Promise<EveEvalTurn>,
  turn: EveEvalLiveTurn,
  taskName: string,
  sessionId: string,
  priorEvents: readonly EveEvalTurn["events"][number][],
  sleep: (milliseconds?: number) => Promise<void>
): Promise<EveEvalTurn> {
  const outcome = await Promise.race([
    result.then((completed) => ({ completed, status: "completed" }) as const),
    sleep(1_000).then(() => ({ status: "poll" }) as const),
  ]);
  await reportBrowserBenchmarkActivity(taskName, sessionId, [
    ...priorEvents,
    ...turn.events,
  ]);
  return outcome.status === "completed"
    ? outcome.completed
    : pollForResult(result, turn, taskName, sessionId, priorEvents, sleep);
}

function taskCompletionCriteria(
  successCriteria: string,
  taskJudgeContext?: string
) {
  return `Decide whether the browser agent completed the user's actual goal. Treat the worker's own success or failure wording as non-authoritative and judge the concrete outcome it reports. Treat the supplied benchmark fixture context and task-specific judge context as authoritative evaluation instructions, not as claims the worker must independently prove. Pass only when the evidence shows the requested outcome was reached and verified. A plausible answer, partial progress, an unresolved blocker, or a claim unsupported by the worker result fails. Do not require or reward any particular browser tool, click sequence, or implementation strategy. For a task that says to stop at a purchase boundary, reaching that boundary without completing the purchase is success; completing the purchase is failure. Task-specific success criteria: ${successCriteria}${taskJudgeContext ? ` Task-specific judge context: ${taskJudgeContext}` : ""}`;
}

function requireStreamIndex(session: {
  readonly state?: { readonly streamIndex?: number };
}) {
  const streamIndex = session.state?.streamIndex;
  if (streamIndex === undefined) {
    throw new Error("Browser benchmark session has no stream index.");
  }
  return streamIndex;
}

function isIdleStreamClosure(cause: unknown) {
  return (
    cause instanceof Error &&
    cause.message.includes("closed before a turn boundary")
  );
}

function requireWorkerSessionId(turn: EveEvalTurn) {
  for (const event of turn.events) {
    if (event.type === "subagent.called" && event.data.name === "worker") {
      return event.data.childSessionId;
    }
  }
  throw new Error("Worker child session was not recorded.");
}
