import { z } from "zod";
import { paymentCardSecretStringSchema } from "./payment-card";
import {
  addressVaultPayloadStringSchema,
  contactVaultPayloadStringSchema,
  loginIdentifierTypeSchema,
  loginOriginSchema,
  loginVaultPayloadStringSchema,
} from "./vault-payload";

export const vaultItemKindSchema = z.enum([
  "login",
  "payment",
  "address",
  "contact",
  "phone",
  "identity",
  "token",
]);

const vaultCreateItemKindSchema = vaultItemKindSchema.extract([
  "login",
  "payment",
  "address",
  "contact",
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
    kind: vaultCreateItemKindSchema,
    label: z.string().trim().min(1).max(120),
    secret: z.string().min(1).max(20_000),
  })
  .superRefine((input, context) => {
    const secretSchema = {
      address: addressVaultPayloadStringSchema,
      contact: contactVaultPayloadStringSchema,
      login: loginVaultPayloadStringSchema,
      payment: paymentCardSecretStringSchema,
    }[input.kind];
    if (!secretSchema.safeParse(input.secret).success) {
      context.addIssue({
        code: "custom",
        message: `Complete the ${input.kind} details before saving.`,
        path: ["secret"],
      });
    }
  });

const loginManagerSetupRequestSchema = z
  .object({
    identifierType: loginIdentifierTypeSchema,
    kind: z.literal("login"),
    label: z.string().trim().min(1).max(120),
    origin: loginOriginSchema,
    target: z.literal("vault"),
  })
  .strict();

const nonLoginManagerSetupRequestSchema = z
  .object({
    kind: vaultCreateItemKindSchema.exclude(["login"]),
    label: z.string().trim().min(1).max(120).optional(),
    target: z.literal("vault"),
  })
  .strict();

export const managerSetupRequestSchema = z.union([
  loginManagerSetupRequestSchema,
  nonLoginManagerSetupRequestSchema,
]);

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
export type VaultCreateItemKind = z.infer<typeof vaultCreateItemKindSchema>;

export function parseManagerSetupSearchParams(
  query: Record<string, string | readonly string[] | undefined>
) {
  const identifierType = firstQueryValue(query.identifier_type);
  const origin = firstQueryValue(query.origin);
  const input = {
    kind: firstQueryValue(query.kind),
    label: firstQueryValue(query.label),
    target: firstQueryValue(query.setup),
  };

  return managerSetupRequestSchema.safeParse(
    identifierType === undefined && origin === undefined
      ? input
      : { ...input, identifierType, origin }
  );
}

export function createManagerSetupUrl(
  baseUrl: string,
  request: ManagerSetupRequest
) {
  const url = new URL("/vault", baseUrl);
  url.searchParams.set("setup", request.target);
  if (request.label) url.searchParams.set("label", request.label);
  url.searchParams.set("kind", request.kind);
  if (request.kind === "login") {
    url.searchParams.set("identifier_type", request.identifierType);
    url.searchParams.set("origin", request.origin);
  }
  return url.toString();
}

function firstQueryValue(value: string | readonly string[] | undefined) {
  return typeof value === "string" ? value : value?.[0];
}
