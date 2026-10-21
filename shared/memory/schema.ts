import { z } from "zod";

export const memoryIdSchema = z.string().trim().min(1).max(200);
export const memoryKindSchema = z.enum([
  "person",
  "organization",
  "preference",
  "episode",
]);
const memoryStatusSchema = z.enum(["active", "disputed", "expired"]);
export const memorySourceSchema = z.strictObject({
  id: memoryIdSchema,
  kind: z.enum([
    "user",
    "user_edit",
    "browser_receipt",
    "schedule_receipt",
    "legacy",
  ]),
  text: z.string().max(16_000),
  reference: z.string().trim().min(1).max(500),
  sessionId: z.string().min(1).max(200).nullable().default(null),
  turnId: z.string().min(1).max(200).nullable().default(null),
  observedAt: z.iso.datetime({ offset: true }),
  sensitive: z.boolean().default(false),
  excluded: z.boolean().default(false),
});
const memoryEvidenceSchema = z
  .strictObject({
    sourceId: memoryIdSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((value) => value.end > value.start, {
    message: "An evidence span must contain text.",
  });
export const memoryRecordContentSchema = z.strictObject({
  kind: memoryKindSchema,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(3_000),
  aliases: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  status: memoryStatusSchema.default("active"),
  evidence: z.array(memoryEvidenceSchema).min(1).max(8),
  effectiveAt: z.iso.datetime({ offset: true }).nullable().default(null),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const saveMemoryRecordSchema = z.strictObject({
  id: memoryIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  content: memoryRecordContentSchema,
});
export const editMemoryRecordSchema = z.strictObject({
  id: memoryIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  kind: memoryKindSchema,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(3_000),
  aliases: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
});
export const forgetMemoryRecordSchema = saveMemoryRecordSchema.pick({
  id: true,
  expectedRevision: true,
});
export const findMemoryRecordsSchema = z.strictObject({
  query: z.string().trim().max(200).default(""),
  kind: memoryKindSchema.optional(),
  includeHistorical: z.boolean().default(false),
  offset: z.number().int().nonnegative().default(0),
});
const memoryLinkSchema = z.strictObject({
  fromId: memoryIdSchema,
  toId: memoryIdSchema,
  relation: z.string().trim().min(1).max(80),
});
export const memoryProposalSchema = z.strictObject({
  records: z.array(saveMemoryRecordSchema).max(30),
  links: z.array(memoryLinkSchema).max(60).default([]),
});
export const memoryRecallSchema = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        content: z.string().max(30_000),
      })
    )
    .max(4),
});
export type MemoryRecordContent = z.infer<typeof memoryRecordContentSchema>;
export type MemorySourceInput = z.input<typeof memorySourceSchema>;
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;
