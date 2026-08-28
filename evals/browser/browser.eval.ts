import { defineEval, type EveEvalSession, type EveEvalTurn } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import {
  didCompleteBrowserWorker,
  didFinishBrowserWorker,
} from "@/lib/browser/benchmark";
import { browserBenchmarkTasks } from "@/lib/browser/benchmark-tasks";
import { browserBenchmarkEnv } from "@/evals/browser/env";

const repetitions = browserBenchmarkEnv.BROWSER_BENCH_REPETITIONS;

export default browserBenchmarkTasks.flatMap((task) =>
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

        let session: EveEvalSession | typeof t = t;
        let completed: EveEvalTurn | null = null;
        const workerEvents = [...started.events];
        for (let attempt = 0; attempt < 8 && completed === null; attempt += 1) {
          const live = t.target.watchTurn(started.sessionId, {
            startIndex: requireStreamIndex(session),
          });
          const turn = await live.result();
          turn.expectOk();
          workerEvents.push(...turn.events);
          if (didFinishBrowserWorker(workerEvents)) completed = turn;
          session = live.session;
        }

        await t.require(
          completed,
          satisfies(
            (turn) => turn !== null,
            "the worker's native completion wakes the parent"
          )
        );
        await t.require(
          didCompleteBrowserWorker(workerEvents),
          satisfies(
            (workerSucceeded) => workerSucceeded === true,
            "the worker completed the browser assignment successfully"
          )
        );

        const child = await t.target.attachSession(childSessionId);
        child.succeeded();
        await t.require(
          child.events.filter((event) => event.type === "result.completed")
            .length,
          satisfies(
            (count) => count === 1,
            "the worker emitted exactly one native structured result"
          )
        );
        await t.require(
          child.events.some(
            (event) =>
              event.type === "action.result" &&
              event.data.status === "completed" &&
              event.data.result.kind === "tool-result" &&
              [
                "computer_action",
                "execute_playwright_code",
                "manage_browsers",
              ].includes(event.data.result.toolName)
          ),
          satisfies(
            (usedBrowserTool) => usedBrowserTool === true,
            "the worker executed a browser tool"
          )
        );

        t.succeeded();

        for (const expected of task.expectedReplyIncludes) {
          t.check(completed?.message, includes(expected)).label(
            `reply includes ${expected}`
          );
        }
      },
    })
  )
);

function requireWorkerSessionId(turn: EveEvalTurn) {
  for (const event of turn.events) {
    if (event.type === "subagent.called" && event.data.name === "worker") {
      return event.data.childSessionId;
    }
  }
  throw new Error("Worker child session was not recorded.");
}

function requireStreamIndex(
  session:
    | EveEvalSession
    | { readonly state?: { readonly streamIndex?: number } }
) {
  const streamIndex = session.state?.streamIndex;
  if (streamIndex === undefined) {
    throw new Error("Browser benchmark session has no stream index.");
  }
  return streamIndex;
}
