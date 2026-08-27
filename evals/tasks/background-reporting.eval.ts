import { defineEval, type EveEvalSession, type EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const FAST_RESULT = "task-reporting-fast";
const SLOW_RESULT = "task-reporting-slow";

export default defineEval({
  description:
    "Background workers get one concise acknowledgment, keep partial wakes silent, and produce one combined report.",
  tags: ["real-model", "task-reporting"],
  timeoutMs: 120_000,
  async test(t) {
    const started = await t.send(
      [
        "This is a background-task runtime test.",
        "Start exactly two background workers in this initiating turn. Issue both agent calls before acknowledging that work is underway.",
        `First task message: Return exactly ${FAST_RESULT} and nothing else.`,
        `Second task message: Call web_fetch exactly once for https://example.com, then return exactly ${SLOW_RESULT} and nothing else.`,
        "Do not repeat either result yourself before both workers finish.",
      ].join("\n")
    );

    started.expectOk();
    started.calledSubagent("agent", { count: 2 });
    await t.require(
      started.message,
      satisfies(
        (message) =>
          typeof message === "string" &&
          message.trim().length > 0 &&
          !message.toLowerCase().includes(FAST_RESULT) &&
          !message.toLowerCase().includes(SLOW_RESULT),
        "the initiating turn acknowledges background work without claiming the result"
      )
    );
    await t.require(
      acknowledgmentCount(started),
      satisfies(
        (count: number) => count === 1,
        "the initiating turn emits one acknowledgment"
      )
    );

    const taskIds = backgroundTaskIds(started);
    await t.require(
      taskIds,
      satisfies(
        (values: string[]) => values.length === 2 && new Set(values).size === 2,
        "both workers return distinct background task ids"
      )
    );

    let session: EveEvalSession | typeof t = t;
    let finalReport: EveEvalTurn | null = null;
    let sawIntermediateWake = false;
    for (let attempt = 0; attempt < 8 && finalReport === null; attempt += 1) {
      const live = t.target.watchTurn(started.sessionId, {
        startIndex: requireStreamIndex(session),
      });
      const turn = await live.result();
      turn.noFailedActions();
      const incoming = receivedText(turn).toLowerCase();
      const message = turn.message?.toLowerCase();
      if (message?.includes(FAST_RESULT) && message.includes(SLOW_RESULT)) {
        finalReport = turn;
      } else {
        if (incoming.includes(FAST_RESULT) || incoming.includes(SLOW_RESULT)) {
          sawIntermediateWake = true;
        }
        await t.require(
          turn.message,
          satisfies(
            (message) => message === undefined,
            "intermediate task wakes stay silent"
          )
        );
      }
      session = live.session;
    }

    await t.require(
      sawIntermediateWake,
      satisfies(
        (value: boolean) => value,
        "a partial task completion wakes the parent silently"
      )
    );
    await t.require(
      finalReport,
      satisfies(
        (turn) => turn !== null,
        "the settled tasks produce a final parent report"
      )
    );
    t.noFailedActions();
  },
});

function backgroundTaskIds(turn: EveEvalTurn): string[] {
  return turn.events.flatMap((event) =>
    event.type === "subagent.completed" &&
    event.data.subagentName === "agent" &&
    event.data.backgroundTask !== undefined
      ? [event.data.backgroundTask.taskId]
      : []
  );
}

function acknowledgmentCount(turn: EveEvalTurn): number {
  return turn.events.filter(
    (event) =>
      event.type === "message.completed" &&
      event.data.finishReason !== "tool-calls" &&
      event.data.message !== null &&
      event.data.message.trim().length > 0
  ).length;
}

function receivedText(turn: EveEvalTurn): string {
  return turn.events
    .flatMap((event) =>
      event.type === "message.received" ? [event.data.message] : []
    )
    .join("\n");
}

function requireStreamIndex(
  session:
    | EveEvalSession
    | { readonly state?: { readonly streamIndex?: number } }
): number {
  const streamIndex = session.state?.streamIndex;
  if (streamIndex === undefined) {
    throw new Error("Task-reporting session has no stream index.");
  }
  return streamIndex;
}
