import { z } from "zod";
import { paymentCardSecretStringSchema } from "./payment-card";

export const DEFAULT_LOCAL_MANAGER_URL =
  "https://local-vault-assistant.localhost";

export const connectionProviderSchema = z.enum([
  "kernel",
  "local-model",
  "telegram",
  "email",
  "custom",
]);

export const browserModeSchema = z.enum(["local", "cloud"]);

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
  "address",
  "phone",
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
  browser: z.object({
    cloudAvailable: z.boolean(),
    localAvailable: z.boolean(),
    mode: browserModeSchema,
  }),
  connections: z.array(managerConnectionSchema),
  runtime: z.object({
    inference: z.string(),
    mode: z.enum(["hosted", "local-first"]),
    source: z.enum(["gateway", "local"]),
  }),
  secretStore: z.object({
    available: z.boolean(),
    description: z.string(),
    kind: z.string(),
  }),
  vaultItems: z.array(managerVaultItemSchema),
});

const connectionInputSchema = z
  .object({
    account: z.string().trim().max(200).default(""),
    endpoint: z.string().trim().max(2_000).default(""),
    label: z.string().trim().min(1).max(120),
    provider: connectionProviderSchema,
    secret: z.string().max(20_000).default(""),
  })
  .superRefine((input, context) => {
    if (input.provider === "kernel") {
      context.addIssue({
        code: "custom",
        message: "Kernel is configured through the system environment.",
        path: ["provider"],
      });
    }
    if (input.provider === "telegram" && input.secret.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "A Telegram bot token is required.",
        path: ["secret"],
      });
    }
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

const setupPrefillSchema = z.object({
  account: z.string().trim().max(200).optional(),
  label: z.string().trim().max(120).optional(),
});

export const managerSetupRequestSchema = z.discriminatedUnion("target", [
  setupPrefillSchema
    .extend({
      endpoint: z.string().trim().max(2_000).optional(),
      provider: connectionProviderSchema,
      target: z.literal("connection"),
    })
    .strict(),
  setupPrefillSchema
    .extend({
      kind: vaultItemKindSchema,
      target: z.literal("vault"),
    })
    .strict(),
]);

export const managerMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("browser.select"), mode: browserModeSchema }),
  z.object({
    action: z.literal("connection.create"),
    input: connectionInputSchema,
  }),
  z.object({ action: z.literal("connection.delete"), id: z.string().min(1) }),
  z.object({
    action: z.literal("model.select"),
    modelId: z.string().trim().min(1).max(300),
  }),
  z.object({ action: z.literal("vault.create"), input: vaultItemInputSchema }),
  z.object({ action: z.literal("vault.delete"), id: z.string().min(1) }),
]);

export type BrowserMode = z.infer<typeof browserModeSchema>;
export type ConnectionProvider = z.infer<typeof connectionProviderSchema>;
export type ManagerMutation = z.infer<typeof managerMutationSchema>;
export type ManagerSetupRequest = z.infer<typeof managerSetupRequestSchema>;
export type ManagerSnapshot = z.infer<typeof managerSnapshotSchema>;
export type VaultItemKind = z.infer<typeof vaultItemKindSchema>;

export function createManagerSetupUrl(
  baseUrl: string,
  request: ManagerSetupRequest
) {
  const url = new URL(request.target === "vault" ? "/vault" : "/", baseUrl);
  url.searchParams.set("setup", request.target);
  if (request.account) url.searchParams.set("account", request.account);
  if (request.label) url.searchParams.set("label", request.label);

  if (request.target === "connection") {
    url.searchParams.set("provider", request.provider);
    if (request.endpoint) url.searchParams.set("endpoint", request.endpoint);
  } else {
    url.searchParams.set("kind", request.kind);
  }

  return url.toString();
}

export function isLocalManagerHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function isAllowedManagerMutationOrigin({
  forwardedHost,
  forwardedProto,
  host,
  origin,
  requestUrl,
}: {
  forwardedHost: string | null;
  forwardedProto: string | null;
  host: string | null;
  origin: string | null;
  requestUrl: string;
}) {
  return isAllowedMutationOrigin(
    { forwardedHost, forwardedProto, host, origin, requestUrl },
    true
  );
}

export function isAllowedMutationOrigin(
  {
    forwardedHost,
    forwardedProto,
    host,
    origin,
    requestUrl,
  }: {
    forwardedHost: string | null;
    forwardedProto: string | null;
    host: string | null;
    origin: string | null;
    requestUrl: string;
  },
  localOnly = false
) {
  if (!origin) return true;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (localOnly && !isLocalManagerHostname(parsedOrigin.hostname)) return false;

  const request = new URL(requestUrl);
  const allowedOrigins = new Set([request.origin]);
  const protocol = firstForwardedValue(forwardedProto) ?? request.protocol;

  for (const candidateHost of [forwardedHost, host]) {
    const candidate = firstForwardedValue(candidateHost);
    if (!candidate) continue;
    try {
      const candidateUrl = new URL(
        `${normalizeProtocol(protocol)}//${candidate}`
      );
      if (!localOnly || isLocalManagerHostname(candidateUrl.hostname)) {
        allowedOrigins.add(candidateUrl.origin);
      }
    } catch {
      continue;
    }
  }

  return allowedOrigins.has(parsedOrigin.origin);
}

function firstForwardedValue(value: string | null) {
  const first = value?.split(",", 1)[0]?.trim();
  return first?.length ? first : undefined;
}

function normalizeProtocol(protocol: string) {
  return protocol.endsWith(":") ? protocol : `${protocol}:`;
}
