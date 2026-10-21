import {
  defineMemoryProvider,
  type MemoryOperationContext,
  type MemoryProvider,
} from "eve/memory";
import {
  MemoryDocumentConflictError,
  type MemoryDocumentBackend,
} from "eve/memory/file";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { resolveModeValue } from "@agent/lib/mode";
import { eligibleKnowledgeText } from "@agent/lib/memory/ingest";
import {
  importLegacyMemory,
  readLegacyMemoryImport,
  withLegacyMemoryLock,
} from "@db/services/memory/legacy";
import { readMemoryBinding } from "@db/services/memory/scope";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";

const emptyProfile = {
  messages: [
    {
      id: "file-memory-document",
      content:
        "Legacy profile memory is inactive. Use the current knowledge memory when available.",
    },
  ],
};

export function withProfileMemoryMigration(
  provider: MemoryProvider,
  backend: MemoryDocumentBackend
) {
  async function cutover(context: MemoryOperationContext) {
    const caller = context.session.auth.current;
    if (caller?.principalType !== "user") return false;
    const scope = scopeFromPrincipal(caller);
    const key = context.memory.scope.key;
    const migration = await withLegacyMemoryLock(
      scope,
      key,
      async (transaction) => {
        const imported = await readLegacyMemoryImport(scope, key, transaction);
        const enabled =
          knowledgeMemoryModeForWorkspace(scope.workspaceId) === "enabled";
        if (!enabled && !imported) return { active: false, document: null };
        const binding =
          imported ??
          (await readMemoryBinding(scope, context.session.id, transaction));
        if (!binding) return { active: true, document: null };
        const document = await backend.read({
          key,
          signal: context.abortSignal,
        });
        if (!imported) {
          const entries = document ? legacyEntries(document.content) : [];
          await importLegacyMemory(
            scope,
            binding.scopeKey,
            {
              legacyScopeKey: key,
              entries: entries.filter((entry) =>
                eligibleKnowledgeText(entry.text)
              ),
            },
            transaction
          );
        }
        return { active: true, document };
      }
    );
    const { document } = migration;
    if (document && legacyEntries(document.content).length > 0) {
      try {
        await backend.write({
          key,
          signal: context.abortSignal,
          expectedVersion: document.version,
          content: `${document.content.slice(0, document.content.indexOf("\n"))}\n`,
        });
      } catch (error) {
        if (!MemoryDocumentConflictError.is(error)) throw error;
      }
    }
    return migration.active;
  }

  return defineMemoryProvider({
    ...provider,
    recall: {
      async "turn.started"(context) {
        return (await cutover(context))
          ? emptyProfile
          : provider.recall["turn.started"](context);
      },
      async "compaction.completed"(context) {
        return (await cutover(context))
          ? emptyProfile
          : provider.recall["compaction.completed"]?.(context);
      },
    },
    async tools(context) {
      const caller = context.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        resolveModeValue(context, { interactive: true }) !== true
      )
        return null;
      const scope = scopeFromPrincipal(caller);
      if (
        knowledgeMemoryModeForWorkspace(scope.workspaceId) === "enabled" ||
        (await readLegacyMemoryImport(scope, context.memory.scope.key))
      )
        return null;
      const tools = await provider.tools?.(context);
      if (!tools) return null;
      return Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [
          name,
          {
            ...tool,
            async execute(input, toolContext) {
              return withLegacyMemoryLock(
                scope,
                context.memory.scope.key,
                async (transaction) => {
                  if (
                    await readLegacyMemoryImport(
                      scope,
                      context.memory.scope.key,
                      transaction
                    )
                  )
                    throw new Error(
                      "Profile memory has migrated. Use knowledge memory in a new turn."
                    );
                  return tool.execute(input, toolContext);
                }
              );
            },
          },
        ])
      );
    },
  });
}

function legacyEntries(document: string) {
  if (Buffer.byteLength(document) > 65_536)
    throw new Error("The legacy memory document is too large.");
  const header =
    /^<!-- eve-memory-file-v1 lastAllocatedIndex=(-1|0|[1-9]\d*) -->\n/u.exec(
      document
    );
  if (!header)
    throw new Error("The legacy memory document has an unsupported format.");
  const lastIndex = Number(header[1]);
  const body = document.slice(header[0].length);
  if (!Number.isSafeInteger(lastIndex) || (body && !body.endsWith("\n"))) {
    throw new Error("The legacy memory document is invalid.");
  }
  const seen = new Set<number>();
  return body
    ? body
        .slice(0, -1)
        .split("\n")
        .map((line) => {
          const entry = /^(\d+): (.+)$/u.exec(line);
          const index = Number(entry?.[1]);
          const text = entry?.[2];
          if (
            !text ||
            !Number.isSafeInteger(index) ||
            index > lastIndex ||
            seen.has(index)
          ) {
            throw new Error(
              "The legacy memory document contains an invalid entry."
            );
          }
          seen.add(index);
          return { index, text };
        })
    : [];
}
