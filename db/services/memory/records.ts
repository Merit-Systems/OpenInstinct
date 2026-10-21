/* oxlint-disable eslint/no-await-in-loop -- Transaction mutations and validations must follow their dependent writes. */
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import {
  db,
  memoryArtifacts,
  memoryGenerations,
  memoryLinks,
  memoryRecords,
  memoryRevisions,
  memorySources,
} from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { eligibleKnowledgeText } from "@shared/memory/policy";
import {
  editMemoryRecordSchema,
  findMemoryRecordsSchema,
  forgetMemoryRecordSchema,
  saveMemoryRecordSchema,
  type MemoryRecordContent,
} from "@shared/memory/schema";
import {
  lockMemoryState,
  requireMemoryMembership,
  type MemoryTransaction,
} from "./scope";
import { enqueueMemoryJob, insertMemorySources } from "./sources";
import { publishMemoryGeneration } from "./generations";
import { purgeMemoryContent } from "./purge";

async function validateMemoryEvidence(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  content: MemoryRecordContent,
  allowedSources?: readonly { id: string; version: number }[]
) {
  let supported = false;
  for (const span of content.evidence) {
    const [source] = await transaction
      .select()
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.id, span.sourceId)
        )
      )
      .limit(1);
    if (
      !source?.text ||
      !["pending", "processed"].includes(source.status) ||
      span.end > source.text.length ||
      !source.text.slice(span.start, span.end).trim()
    )
      throw new Error(
        "Memory evidence is missing, removed, or has an invalid span."
      );
    supported ||= source.text.slice(span.start, span.end) === content.body;
    if (
      allowedSources &&
      !allowedSources.some(
        (allowed) =>
          allowed.id === source.id && allowed.version === source.version
      )
    )
      throw new Error("Memory evidence is outside this maintenance claim.");
    if (
      content.kind === "preference" &&
      !["user", "user_edit", "legacy"].includes(source.kind)
    )
      throw new Error("Personal preferences require the user's own statement.");
  }
  if (!supported)
    throw new Error(
      "A memory claim must match an exact supporting source span."
    );
}

export async function writeMemoryRecord(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  value: z.input<typeof saveMemoryRecordSchema>,
  operationId: string,
  explicit: boolean,
  allowedSources?: readonly { id: string; version: number }[]
) {
  const input = saveMemoryRecordSchema.parse(value);
  if (
    !eligibleKnowledgeText(
      [input.content.title, input.content.body, ...input.content.aliases].join(
        "\n"
      )
    )
  )
    throw new Error(
      "Credentials and excluded statements cannot be saved in memory."
    );
  const identity = and(
    eq(memoryRecords.workspaceId, scope.workspaceId),
    eq(memoryRecords.scopeKey, scopeKey),
    eq(memoryRecords.id, input.id)
  );
  const [current] = await transaction
    .select()
    .from(memoryRecords)
    .where(identity)
    .limit(1);
  if (current?.content === null)
    throw new Error(
      "This memory was forgotten. Use a new ID for a new explicit memory."
    );
  if (current?.lastOperationId === operationId) {
    if (!isDeepStrictEqual(current.content, input.content))
      throw new Error(
        "A memory operation cannot be replayed with different content."
      );
    return { ...current, replayed: true };
  }
  if ((current?.revision ?? 0) !== input.expectedRevision)
    throw new Error(
      "Memory changed. Read the current revision before updating it."
    );
  if (current?.explicit && !explicit)
    throw new Error(
      "Automatic maintenance cannot replace an explicit correction."
    );
  await validateMemoryEvidence(
    transaction,
    scope,
    scopeKey,
    input.content,
    allowedSources
  );
  if (!current) {
    const [total] = await transaction
      .select({ value: count() })
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.workspaceId, scope.workspaceId),
          eq(memoryRecords.scopeKey, scopeKey),
          isNotNull(memoryRecords.content)
        )
      );
    if ((total?.value ?? 0) >= 1_000)
      throw new Error(
        "Memory is full (1,000 records). Forget obsolete records before adding more."
      );
  }
  const values = {
    content: input.content,
    revision: input.expectedRevision + 1,
    explicit,
    lastOperationId: operationId,
    updatedAt: new Date(),
  };
  const [record] = current
    ? await transaction
        .update(memoryRecords)
        .set(values)
        .where(identity)
        .returning()
    : await transaction
        .insert(memoryRecords)
        .values({
          ...values,
          workspaceId: scope.workspaceId,
          scopeKey,
          id: input.id,
        })
        .returning();
  if (!record) throw new Error("The memory could not be saved.");
  if (current) {
    const removedLinks = await transaction
      .delete(memoryLinks)
      .where(
        and(
          eq(memoryLinks.workspaceId, scope.workspaceId),
          eq(memoryLinks.scopeKey, scopeKey),
          or(eq(memoryLinks.fromId, input.id), eq(memoryLinks.toId, input.id))
        )
      )
      .returning();
    const affectedIds = [
      ...new Set([
        input.id,
        ...removedLinks.flatMap((link) => [link.fromId, link.toId]),
      ]),
    ];
    await transaction
      .update(memoryArtifacts)
      .set({ status: "purge" })
      .where(
        and(
          eq(memoryArtifacts.workspaceId, scope.workspaceId),
          eq(memoryArtifacts.scopeKey, scopeKey),
          inArray(memoryArtifacts.recordId, affectedIds),
          eq(memoryArtifacts.status, "published")
        )
      );
  }
  await transaction.insert(memoryRevisions).values({
    workspaceId: scope.workspaceId,
    scopeKey,
    recordId: record.id,
    revision: record.revision,
    content: input.content,
    explicit,
  });
  return { ...record, replayed: false };
}

export async function saveMemoryRecord(
  scope: AccessScope,
  scopeKey: string,
  value: z.input<typeof saveMemoryRecordSchema>,
  operationId: string,
  authority: { sourceId: string }
) {
  const input = saveMemoryRecordSchema.parse(value);
  return db.transaction(async (transaction) => {
    await lockMemoryState(transaction, scope, scopeKey);
    const [source] = await transaction
      .select()
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.id, authority.sourceId)
        )
      )
      .limit(1);
    if (
      !source?.text ||
      !["user", "user_edit"].includes(source.kind) ||
      !["pending", "processed"].includes(source.status) ||
      !source.text.includes(input.content.body) ||
      input.content.evidence.some(
        (evidence) =>
          evidence.sourceId !== authority.sourceId ||
          source.text?.slice(evidence.start, evidence.end) !==
            input.content.body
      )
    )
      throw new Error(
        "An explicit memory must quote the current user's eligible statement."
      );
    const record = await writeMemoryRecord(
      transaction,
      scope,
      scopeKey,
      input,
      operationId,
      true
    );
    await transaction
      .update(memorySources)
      .set({ status: "processed" })
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.id, source.id)
        )
      );
    if (!record.replayed) {
      const generation = await publishMemoryGeneration(
        transaction,
        scope,
        scopeKey
      );
      await enqueueMemoryJob(
        transaction,
        scope,
        scopeKey,
        generation.deletionEpoch,
        true
      );
    }
    return recordResult(record);
  });
}

export async function editMemoryRecord(
  scope: AccessScope,
  scopeKey: string,
  value: z.input<typeof editMemoryRecordSchema>,
  operationId: string = randomUUID()
) {
  const input = editMemoryRecordSchema.parse(value);
  return db.transaction(async (transaction) => {
    await lockMemoryState(transaction, scope, scopeKey);
    const sourceId = `edit-${createHash("sha256").update(operationId).digest("hex")}`;
    await insertMemorySources(transaction, scope, scopeKey, [
      {
        id: sourceId,
        kind: "user_edit",
        text: input.body,
        reference: "Authenticated memory editor",
        observedAt: new Date().toISOString(),
      },
    ]);
    const record = await writeMemoryRecord(
      transaction,
      scope,
      scopeKey,
      {
        id: input.id,
        expectedRevision: input.expectedRevision,
        content: {
          kind: input.kind,
          title: input.title,
          body: input.body,
          aliases: input.aliases,
          evidence: [{ sourceId, start: 0, end: input.body.length }],
        },
      },
      operationId,
      true
    );
    await transaction
      .update(memorySources)
      .set({ status: "processed" })
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.id, sourceId)
        )
      );
    if (!record.replayed) {
      const generation = await publishMemoryGeneration(
        transaction,
        scope,
        scopeKey
      );
      await enqueueMemoryJob(
        transaction,
        scope,
        scopeKey,
        generation.deletionEpoch,
        true
      );
    }
    return recordResult(record);
  });
}

export async function forgetMemoryRecord(
  scope: AccessScope,
  scopeKey: string,
  value: z.input<typeof forgetMemoryRecordSchema>,
  operationId: string
) {
  const input = forgetMemoryRecordSchema.parse(value);
  return db.transaction(async (transaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    const [record] = await transaction
      .select()
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.workspaceId, scope.workspaceId),
          eq(memoryRecords.scopeKey, scopeKey),
          eq(memoryRecords.id, input.id)
        )
      )
      .limit(1);
    if (record?.content === null)
      return {
        forgotten: true,
        recordIds: [input.id],
        deletionEpoch: state.deletionEpoch,
      };
    if ((record?.revision ?? 0) !== input.expectedRevision)
      throw new Error(
        "Memory changed. Read the current revision before forgetting it."
      );
    const result = await purgeMemoryContent(transaction, scope, scopeKey, {
      recordIds: [input.id],
      operationId,
      forgetBefore: new Date(),
    });
    await publishMemoryGeneration(transaction, scope, scopeKey);
    return result;
  });
}

const patternFor = (text: string) => `%${text.replace(/[\\%_]/gu, "\\$&")}%`;

export async function findMemoryRecords(
  scope: AccessScope,
  scopeKey: string,
  value: z.input<typeof findMemoryRecordsSchema> = {}
) {
  const input = findMemoryRecordsSchema.parse(value);
  await requireMemoryMembership(scope);
  const pattern = patternFor(input.query);
  const stopWords = new Set([
    "what",
    "do",
    "i",
    "the",
    "about",
    "know",
    "remember",
    "tell",
    "me",
    "and",
    "with",
    "for",
    "a",
    "an",
    "to",
    "is",
    "are",
    "my",
    "of",
    "in",
  ]);
  const terms = [
    ...new Set(
      input.query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []
    ),
  ]
    .filter((term) => term.length > 1 && !stopWords.has(term))
    .slice(0, 8);
  const searchable = sql`concat(${memoryRecords.id}, ' ', ${memoryRecords.content}->>'title', ' ', ${memoryRecords.content}->>'body', ' ', ${memoryRecords.content}->'aliases')`;
  const matches = terms.map(
    (term) => sql`${searchable} ILIKE ${patternFor(term)}`
  );
  const score = sql`CASE WHEN ${memoryRecords.id} = ${input.query} THEN 100 WHEN lower(${memoryRecords.content}->>'title') = ${input.query.toLowerCase()} OR jsonb_exists(${memoryRecords.content}->'aliases', ${input.query}) THEN 80 ELSE 0 END + ${
    terms.length
      ? sql.join(
          terms.map(
            (term) =>
              sql`CASE WHEN concat(${memoryRecords.content}->>'title', ' ', ${memoryRecords.content}->'aliases') ILIKE ${patternFor(term)} THEN 4 WHEN ${searchable} ILIKE ${patternFor(term)} THEN 1 ELSE 0 END`
          ),
          sql` + `
        )
      : sql`0`
  }`;
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.workspaceId, scope.workspaceId),
        eq(memoryRecords.scopeKey, scopeKey),
        isNotNull(memoryRecords.content),
        input.kind
          ? sql`${memoryRecords.content}->>'kind' = ${input.kind}`
          : undefined,
        input.includeHistorical
          ? undefined
          : sql`(${memoryRecords.content}->>'status') <> 'expired' AND ((${memoryRecords.content}->>'expiresAt') IS NULL OR (${memoryRecords.content}->>'expiresAt')::timestamptz > now())`,
        input.query
          ? or(
              eq(memoryRecords.id, input.query),
              ilike(memoryRecords.id, pattern),
              sql`${searchable} ILIKE ${pattern}`,
              ...matches
            )
          : undefined
      )
    )
    .orderBy(
      ...(input.query ? [desc(score)] : []),
      desc(memoryRecords.explicit),
      desc(memoryRecords.updatedAt),
      memoryRecords.id
    )
    .limit(21)
    .offset(input.offset);
  return {
    items: rows.slice(0, 20).map(recordResult),
    nextOffset: rows.length > 20 ? input.offset + 20 : null,
  };
}

export async function readMemoryRecord(
  scope: AccessScope,
  scopeKey: string,
  id: string
) {
  await requireMemoryMembership(scope);
  const [record] = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.workspaceId, scope.workspaceId),
        eq(memoryRecords.scopeKey, scopeKey),
        eq(memoryRecords.id, id),
        isNotNull(memoryRecords.content)
      )
    )
    .limit(1);
  if (!record?.content) return null;
  const ids = record.content.evidence.map((evidence) => evidence.sourceId);
  const sources = await db
    .select()
    .from(memorySources)
    .where(
      and(
        eq(memorySources.workspaceId, scope.workspaceId),
        eq(memorySources.scopeKey, scopeKey),
        inArray(memorySources.id, ids),
        isNotNull(memorySources.text)
      )
    );
  return { ...recordResult(record), sources };
}

export async function memoryRecordHistory(
  scope: AccessScope,
  scopeKey: string,
  id: string
) {
  await requireMemoryMembership(scope);
  return db
    .select()
    .from(memoryRevisions)
    .where(
      and(
        eq(memoryRevisions.workspaceId, scope.workspaceId),
        eq(memoryRevisions.scopeKey, scopeKey),
        eq(memoryRevisions.recordId, id)
      )
    )
    .orderBy(desc(memoryRevisions.revision))
    .limit(100);
}

export async function followMemoryLinks(
  scope: AccessScope,
  scopeKey: string,
  id: string
) {
  await requireMemoryMembership(scope);
  const links = await db
    .select()
    .from(memoryLinks)
    .where(
      and(
        eq(memoryLinks.workspaceId, scope.workspaceId),
        eq(memoryLinks.scopeKey, scopeKey),
        or(eq(memoryLinks.fromId, id), eq(memoryLinks.toId, id))
      )
    )
    .limit(40);
  const ids = [
    ...new Set(
      links
        .flatMap((link) => [link.fromId, link.toId])
        .filter((other) => other !== id)
    ),
  ];
  const records = ids.length
    ? await db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.workspaceId, scope.workspaceId),
            eq(memoryRecords.scopeKey, scopeKey),
            inArray(memoryRecords.id, ids),
            isNotNull(memoryRecords.content)
          )
        )
    : [];
  return { links, records: records.map(recordResult) };
}

export async function exportMemoryRecords(
  scope: AccessScope,
  scopeKey: string
) {
  return db.transaction(async (transaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    const records = await transaction
      .select()
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.workspaceId, scope.workspaceId),
          eq(memoryRecords.scopeKey, scopeKey),
          isNotNull(memoryRecords.content)
        )
      )
      .orderBy(memoryRecords.id);
    const sources = await transaction
      .select()
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          isNotNull(memorySources.text)
        )
      )
      .orderBy(memorySources.id);
    const links = await transaction
      .select()
      .from(memoryLinks)
      .where(
        and(
          eq(memoryLinks.workspaceId, scope.workspaceId),
          eq(memoryLinks.scopeKey, scopeKey)
        )
      );
    const history = await transaction
      .select()
      .from(memoryRevisions)
      .where(
        and(
          eq(memoryRevisions.workspaceId, scope.workspaceId),
          eq(memoryRevisions.scopeKey, scopeKey)
        )
      )
      .orderBy(memoryRevisions.recordId, memoryRevisions.revision);
    const [generation] = await transaction
      .select()
      .from(memoryGenerations)
      .where(
        and(
          eq(memoryGenerations.workspaceId, scope.workspaceId),
          eq(memoryGenerations.scopeKey, scopeKey),
          eq(memoryGenerations.generation, state.generation)
        )
      )
      .limit(1);
    return {
      records: records.map(recordResult),
      sources,
      links,
      history,
      generation: generation ?? {
        generation: state.generation,
        deletionEpoch: state.deletionEpoch,
        profile: "",
        currentContext: "",
        recordIds: [],
      },
    };
  });
}

function recordResult(record: typeof memoryRecords.$inferSelect) {
  if (!record.content) throw new Error("This memory was forgotten.");
  return {
    id: record.id,
    revision: record.revision,
    content: record.content,
    explicit: record.explicit,
    updatedAt: record.updatedAt.toISOString(),
  };
}
