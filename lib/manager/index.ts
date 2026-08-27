import { z } from "zod";
import { paymentCardSecretStringSchema } from "./payment-card";

export const vaultItemKindSchema = z.enum([
  "login",
  "payment",
  "address",
  "phone",
  "identity",
  "token",
]);

const vaultSetupKindSchema = vaultItemKindSchema.extract([
  "login",
  "payment",
  "address",
  "phone",
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
  browser: z.object({ available: z.boolean() }),
  googleWorkspace: z.object({
    accountLabel: z.string().nullable(),
    state: z.enum(["connected", "disconnected", "unavailable"]),
  }),
  runtime: z.object({ inference: z.string() }),
  secretStore: z.object({
    available: z.boolean(),
    description: z.string(),
    kind: z.string(),
  }),
  vaultItems: z.array(managerVaultItemSchema),
});

const vaultItemInputSchema = z
  .object({
    account: z.string().trim().max(200).default(""),
    kind: vaultItemKindSchema,
    label: z.string().trim().min(1).max(120),
    secret: z.string().min(1).max(20_000),
  })
  .superRefine((input, context) => {
    if (
      input.kind === "payment" &&
      !paymentCardSecretStringSchema.safeParse(input.secret).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete the card details before saving.",
        path: ["secret"],
      });
    }
  });

export const managerSetupRequestSchema = z
  .object({
    account: z.string().trim().max(200).optional(),
    kind: vaultSetupKindSchema,
    label: z.string().trim().max(120).optional(),
    target: z.literal("vault"),
  })
  .strict();

export const managerMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("model.select"),
    modelId: z.string().trim().min(1).max(300),
  }),
  z.object({ action: z.literal("vault.create"), input: vaultItemInputSchema }),
  z.object({ action: z.literal("vault.delete"), id: z.string().min(1) }),
]);

export type ManagerMutation = z.infer<typeof managerMutationSchema>;
export type ManagerSetupRequest = z.infer<typeof managerSetupRequestSchema>;
export type ManagerSnapshot = z.infer<typeof managerSnapshotSchema>;
export type VaultItemKind = z.infer<typeof vaultItemKindSchema>;

export function createManagerSetupUrl(
  baseUrl: string,
  request: ManagerSetupRequest
) {
  const url = new URL("/vault", baseUrl);
  url.searchParams.set("setup", request.target);
  if (request.account) url.searchParams.set("account", request.account);
  if (request.label) url.searchParams.set("label", request.label);
  url.searchParams.set("kind", request.kind);
  return url.toString();
}
