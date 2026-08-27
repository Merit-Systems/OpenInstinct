import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { browserBenchmarkTasks } from "@/lib/browser-benchmark-tasks";
import { didCompleteKernelBrowserAction } from "@/lib/browser-benchmark";
import { env } from "@/lib/env";

const repetitions = env.BROWSER_BENCH_REPETITIONS;

export default browserBenchmarkTasks.flatMap((task) =>
  Array.from({ length: repetitions }, (_, repetitionIndex) =>
    defineEval({
      description:
        repetitions === 1
          ? task.description
          : `${task.description} [${String(repetitionIndex + 1)}/${String(repetitions)}]`,
      tags: ["browser", "benchmark"],
      async test(t) {
        await t.send(task.prompt);
        t.succeeded();
        t.eventsSatisfy(
          "completed a Kernel browser action",
          didCompleteKernelBrowserAction
        );
        t.calledTool("complete_task", { count: 1 });
        t.calledTool("complete_task", {
          input: { status: "success" },
          count: 1,
        });

        for (const expected of task.expectedReplyIncludes) {
          t.check(t.reply, includes(expected)).label(
            `reply includes ${expected}`
          );
        }
      },
    })
  )
);
