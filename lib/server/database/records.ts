import { z } from "zod";
import { connectionProviderSchema, vaultItemKindSchema } from "../../manager";

export const connectionRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  endpoint: z.string(),
  id: z.string(),
  label: z.string(),
  provider: connectionProviderSchema,
  updatedAt: z.string(),
});

export const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

export const modelStorageSchema = z.object({
  localModel: connectionRecordSchema.optional(),
  settings: z.record(z.string(), z.string()),
});

export type ConnectionRecord = z.infer<typeof connectionRecordSchema>;
export type ModelStorage = z.infer<typeof modelStorageSchema>;
export type VaultRecord = z.infer<typeof vaultRecordSchema>;
