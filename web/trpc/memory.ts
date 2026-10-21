import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  listMemoryBindings,
  readMemoryBinding,
} from "@db/services/memory/scope";
import {
  editMemoryRecord,
  exportMemoryRecords,
  findMemoryRecords,
  forgetMemoryRecord,
  memoryRecordHistory,
  readMemoryRecord,
} from "@db/services/memory/records";
import { readMemoryHealth } from "@db/services/memory/health";
import { readMemoryModelUsage } from "@db/services/memory/usage";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import {
  editMemoryRecordSchema,
  findMemoryRecordsSchema,
  forgetMemoryRecordSchema,
  memoryIdSchema,
} from "@shared/memory/schema";
import { createTRPCRouter, protectedProcedure } from "./init";

const memoryProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (knowledgeMemoryModeForWorkspace(ctx.scope.workspaceId) === "off") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Memory is not enabled.",
    });
  }
  return next();
});
const sessionInput = z.object({ sessionId: z.string().min(1).max(200) });
const scopedMemoryProcedure = memoryProcedure
  .input(sessionInput)
  .use(async ({ ctx, input, next }) => {
    const binding = await readMemoryBinding(ctx.scope, input.sessionId);
    if (!binding) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This chat's memory is unavailable.",
      });
    }
    return next({ ctx: { ...ctx, memoryScopeKey: binding.scopeKey } });
  });
const recordInput = z.strictObject({
  ...sessionInput.shape,
  id: memoryIdSchema,
});
const operationInput = { operationId: z.uuid() };

export const memoryRouter = createTRPCRouter({
  bindings: memoryProcedure.query(async ({ ctx }) => {
    const bindings = await listMemoryBindings(ctx.scope);
    return bindings.map((binding) => ({
      sessionId: binding.sessionId,
      updatedAt: binding.updatedAt.toISOString(),
    }));
  }),
  status: scopedMemoryProcedure
    .input(z.strictObject(sessionInput.shape))
    .query(async ({ ctx }) => {
      const [health, usage] = await Promise.all([
        readMemoryHealth(ctx.scope, ctx.memoryScopeKey),
        readMemoryModelUsage(ctx.scope),
      ]);
      return { ...health, usage };
    }),
  list: scopedMemoryProcedure
    .input(findMemoryRecordsSchema.extend(sessionInput.shape))
    .query(({ ctx, input }) => {
      const { sessionId: _sessionId, ...query } = input;
      return findMemoryRecords(ctx.scope, ctx.memoryScopeKey, query);
    }),
  read: scopedMemoryProcedure
    .input(recordInput)
    .query(({ ctx, input }) =>
      readMemoryRecord(ctx.scope, ctx.memoryScopeKey, input.id)
    ),
  history: scopedMemoryProcedure
    .input(recordInput)
    .query(({ ctx, input }) =>
      memoryRecordHistory(ctx.scope, ctx.memoryScopeKey, input.id)
    ),
  save: scopedMemoryProcedure
    .input(
      editMemoryRecordSchema.extend({
        ...sessionInput.shape,
        ...operationInput,
      })
    )
    .mutation(({ ctx, input }) => {
      const { sessionId: _sessionId, operationId, ...record } = input;
      return editMemoryRecord(
        ctx.scope,
        ctx.memoryScopeKey,
        record,
        operationId
      );
    }),
  forget: scopedMemoryProcedure
    .input(
      forgetMemoryRecordSchema.extend({
        ...sessionInput.shape,
        ...operationInput,
      })
    )
    .mutation(({ ctx, input }) => {
      const { sessionId: _sessionId, operationId, ...record } = input;
      return forgetMemoryRecord(
        ctx.scope,
        ctx.memoryScopeKey,
        record,
        operationId
      );
    }),
  export: scopedMemoryProcedure
    .input(z.strictObject(sessionInput.shape))
    .query(({ ctx }) => exportMemoryRecords(ctx.scope, ctx.memoryScopeKey)),
});
