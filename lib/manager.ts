import { z } from "zod";

export const connectionProviderSchema = z.enum([
  "kernel",
  "local-model",
  "email",
  "custom",
]);

const managerConnectionSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  endpoint: z.string(),
  hasSecret: z.boolean(),
  id: z.string(),
  label: z.string(),
  provider: connectionProviderSchema,
  updatedAt: z.string(),
});

export const vaultItemKindSchema = z.enum([
  "login",
  "payment",
  "identity",
  "token",
]);

const managerVaultItemSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  hasSecret: z.boolean(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

export const managerSnapshotSchema = z.object({
  connections: z.array(managerConnectionSchema),
  runtime: z.object({
    inference: z.string(),
    mode: z.literal("local-first"),
  }),
  secretStore: z.object({
    available: z.boolean(),
    description: z.string(),
    kind: z.string(),
  }),
  vaultItems: z.array(managerVaultItemSchema),
});

const connectionInputSchema = z.object({
  account: z.string().trim().max(200).default(""),
  endpoint: z.string().trim().max(2_000).default(""),
  label: z.string().trim().min(1).max(120),
  provider: connectionProviderSchema,
  secret: z.string().max(20_000).default(""),
});

const vaultItemInputSchema = z.object({
  account: z.string().trim().max(200).default(""),
  kind: vaultItemKindSchema,
  label: z.string().trim().min(1).max(120),
  secret: z.string().min(1).max(20_000),
});

export const managerMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connection.create"),
    input: connectionInputSchema,
  }),
  z.object({ action: z.literal("connection.delete"), id: z.string().min(1) }),
  z.object({ action: z.literal("vault.create"), input: vaultItemInputSchema }),
  z.object({ action: z.literal("vault.delete"), id: z.string().min(1) }),
]);

export type ConnectionProvider = z.infer<typeof connectionProviderSchema>;
export type ManagerMutation = z.infer<typeof managerMutationSchema>;
export type ManagerSnapshot = z.infer<typeof managerSnapshotSchema>;
export type VaultItemKind = z.infer<typeof vaultItemKindSchema>;
