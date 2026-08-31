import { defineEval, type EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import {
  didCompleteBrowserWorker,
  didFinishBrowserWorker,
  readTaskCompletion,
} from "@/lib/browser/benchmark";
import { browserBenchmarkTasks } from "@/lib/browser/benchmark-tasks";
import { browserBenchmarkEnv } from "@/evals/browser/env";

const repetitions = browserBenchmarkEnv.BROWSER_BENCH_REPETITIONS;
const tasks = browserBenchmarkTasks(browserBenchmarkEnv.BROWSER_BENCH_SUITE);

export default tasks.flatMap((task) =>
  Array.from({ length: repetitions }, (_, repetitionIndex) =>
    defineEval({
      description:
        repetitions === 1
          ? task.description
          : `${task.description} [${String(repetitionIndex + 1)}/${String(repetitions)}]`,
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

        for (
          let attempt = 0;
          attempt < 60 && completed === null;
          attempt += 1
        ) {
          try {
            const turn = await child.result();
            turn.expectOk();
            workerEvents.push(...turn.events);
            if (didFinishBrowserWorker(workerEvents)) completed = turn;
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

        await t.require(
          completed,
          satisfies(
            (turn) => turn !== null,
            "the worker emitted a native structured completion"
          )
        );
        await t.require(
          didCompleteBrowserWorker(workerEvents),
          satisfies(
            (workerSucceeded) => workerSucceeded === true,
            "the worker completed the browser assignment successfully"
          )
        );

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
        t.judge.autoevals
          .closedQA(taskCompletionCriteria(task.successCriteria), {
            on: [
              `User task:\n${task.prompt}`,
              `Worker result:\n${workerCompletion?.message ?? "No worker result"}`,
            ].join("\n\n"),
          })
          .label("task completed")
          .gate(0.8);
      },
    })
  )
);

function taskCompletionCriteria(successCriteria: string) {
  return `Decide whether the browser agent completed the user's actual goal. Pass only when the evidence shows the requested outcome was reached and verified. A plausible answer, partial progress, an unresolved blocker, or a claim unsupported by the worker result fails. Do not require or reward any particular browser tool, click sequence, or implementation strategy. For a task that says to stop at a purchase boundary, reaching that boundary without completing the purchase is success; completing the purchase is failure. Task-specific success criteria: ${successCriteria}`;
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

function isIdleStreamClosure(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("closed before a turn boundary")
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
