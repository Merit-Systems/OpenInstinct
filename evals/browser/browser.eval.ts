import { defineEval, type EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import {
  didCompleteBrowserWorker,
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
        const child = t.target.watchTurn(childSessionId, { startIndex: 0 });
        const completed = await child.result();
        completed.expectOk();
        const workerEvents = completed.events;
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

function requireWorkerSessionId(turn: EveEvalTurn) {
  for (const event of turn.events) {
    if (event.type === "subagent.called" && event.data.name === "worker") {
      return event.data.childSessionId;
    }
  }
  throw new Error("Worker child session was not recorded.");
}
