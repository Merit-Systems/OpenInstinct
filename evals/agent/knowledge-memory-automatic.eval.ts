import { setTimeout } from "node:timers/promises";
import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import { env } from "@shared/environment";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { agentEvalTags, requireDeliveredText } from "@evals/agent/shared";
import { memoryScenarioRepetitions } from "@evals/memory/scenarios";

export default memoryScenarioRepetitions.map((repetition) =>
  defineEval({
    description: `AUT-01 ordinary capture, maintenance and fresh recall; repetition ${String(repetition)}`,
    tags: [...agentEvalTags, "knowledge-memory", "knowledge-memory-automatic"],
    timeoutMs: 300_000,
    async test(t) {
      if (env.KNOWLEDGE_MEMORY_MODE !== "enabled") {
        t.skip("Set KNOWLEDGE_MEMORY_MODE=enabled for this opt-in evaluation.");
        return;
      }
      const { readMemoryBinding, setMemoryCaptureDisabled } =
        await import("@db/services/memory/scope");
      const { listMemorySources, readMemorySource } =
        await import("@db/services/memory/sources");
      const { findMemoryRecords, forgetMemoryRecord } =
        await import("@db/services/memory/records");
      const scope = accessScopeForUser("better-auth:browser-benchmark");
      const topic = `marigold-${String(repetition)} notebooks`;
      const statement = `I prefer wide ruled paper in my ${topic}.`;
      let scopeKey: string | undefined;
      let captured: Awaited<ReturnType<typeof readMemorySource>> = null;
      try {
        const first = await t.send(statement);
        first.expectOk();
        first.succeeded();
        first.notCalledTool("knowledge__remember");
        await requireDeliveredText(t, first);
        const binding = await readMemoryBinding(scope, first.sessionId);
        if (!binding)
          throw new Error("The ordinary-input chat has no memory binding.");
        scopeKey = binding.scopeKey;
        const input = (await listMemorySources(scope, scopeKey)).find(
          (candidate) =>
            candidate.sessionId === first.sessionId &&
            candidate.text === statement
        );
        if (!input)
          throw new Error("The authoritative ordinary input was not captured.");
        captured = input;
        await t.require(
          input.status,
          satisfies<typeof input.status>(
            (status) => status === "pending" || status === "processed",
            "the ordinary input is queued or already processed by maintenance"
          )
        );
        const started = Date.now();
        let stored = await readMemorySource(scope, scopeKey, input.id);
        while (stored?.status === "pending" && Date.now() - started < 90_000) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Dispatch another tick when export work or earlier inputs precede this receipt.
          await t.target.dispatchSchedule("memory");
          // oxlint-disable-next-line eslint/no-await-in-loop -- Observe actual background completion instead of assuming cron timing.
          await setTimeout(2_000, undefined, { signal: t.signal });
          // oxlint-disable-next-line eslint/no-await-in-loop -- Poll this isolated source after the scheduled worker runs.
          stored = await readMemorySource(scope, scopeKey, input.id);
        }
        await t.require(stored?.status, equals("processed"));
        const records = (
          await findMemoryRecords(scope, scopeKey, { query: topic })
        ).items;
        await t.require(
          records,
          satisfies<typeof records>(
            (values) =>
              values.some(
                (record) =>
                  !record.explicit &&
                  record.content.body === statement &&
                  record.content.evidence.some(
                    (span) => span.sourceId === input.id
                  )
              ),
            "maintenance published the exact ordinary input with its original evidence"
          )
        );
        t.log(
          `Receipt-to-observed-publication: ${String(Date.now() - input.observedAt.getTime())}ms; local scheduled maintenance, not hosted freshness.`
        );
        const later = await t.send(
          `What paper do I prefer in my ${topic}, and how do you know?`
        );
        later.expectOk();
        later.succeeded();
        const answer = await requireDeliveredText(t, later);
        t.judge(
          "The response recalls wide ruled paper for the user's marigold notebooks, grounds it in the user's earlier statement, and does not invent a purchase, stronger preference, or external source.",
          { on: answer }
        ).atLeast(0.9);
      } finally {
        if (scopeKey) {
          const records = (
            await findMemoryRecords(scope, scopeKey, { query: topic })
          ).items.filter(
            (record) =>
              record.content.body === statement &&
              record.content.evidence.some(
                (span) => span.sourceId === captured?.id
              )
          );
          for (const record of records) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- Remove only this synthetic evaluation's records before the next repetition.
            await forgetMemoryRecord(
              scope,
              scopeKey,
              { id: record.id, expectedRevision: record.revision },
              `eval-cleanup:${record.id}`
            );
          }
          if (captured?.sessionId && captured.turnId)
            await setMemoryCaptureDisabled(
              scope,
              scopeKey,
              captured.sessionId,
              {
                turnId: captured.turnId,
                observedAt: captured.observedAt.toISOString(),
              }
            );
        }
      }
    },
  })
);
