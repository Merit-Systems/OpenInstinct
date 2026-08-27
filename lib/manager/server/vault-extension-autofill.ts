import Kernel from "@onkernel/sdk";
import { CompactEncrypt, importJWK, type JWK } from "jose";
import { z } from "zod";
import type {
  AutofillClaim,
  VaultAutofillCommand,
} from "../vault-autofill-protocol";
import {
  autofillInspectionSchema,
  vaultAutofillExtensionResultSchema,
} from "../vault-autofill-protocol";
import { env } from "../../env";

const publicKeySchema = z.object({
  e: z.string().min(1),
  kty: z.literal("RSA"),
  n: z.string().min(1),
});

export async function inspectWithVaultExtension({
  browserSessionId,
  signal,
}: {
  readonly browserSessionId: string;
  readonly signal?: AbortSignal;
}) {
  const result = await executeExtensionOperation(
    browserSessionId,
    "inspect",
    undefined,
    signal
  );
  return autofillInspectionSchema.parse(result);
}

export async function fillWithVaultExtension({
  browserSessionId,
  claims,
  expectedOrigin,
  signal,
  surfaceId,
}: {
  readonly browserSessionId: string;
  readonly claims: readonly AutofillClaim[];
  readonly expectedOrigin: string;
  readonly signal?: AbortSignal;
  readonly surfaceId: string;
}) {
  const publicKeyResult = await executeExtensionOperation(
    browserSessionId,
    "getPublicKey",
    undefined,
    signal
  );
  const publicJwk = publicKeySchema.parse(publicKeyResult);
  const publicKey = await importJWK(publicJwk as JWK, "RSA-OAEP-256");
  const now = Date.now();
  const command: VaultAutofillCommand = {
    claims: [...claims],
    expectedOrigin,
    expiresAt: now + 30_000,
    issuedAt: now,
    nonce: crypto.randomUUID(),
    surfaceId,
    version: 1,
  };
  const envelope = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(command))
  )
    .setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" })
    .encrypt(publicKey);
  const fillResult = await executeExtensionOperation(
    browserSessionId,
    "fill",
    envelope,
    signal
  );
  return vaultAutofillExtensionResultSchema.parse(fillResult);
}

async function executeExtensionOperation(
  browserSessionId: string,
  operation: "fill" | "getPublicKey" | "inspect",
  argument: string | undefined,
  signal: AbortSignal | undefined
) {
  if (!env.KERNEL_VAULT_AUTOFILL_EXTENSION) {
    throw new Error(
      "Secure vault autofill is unavailable because the browser extension is not configured."
    );
  }

  const client = new Kernel({ apiKey: env.KERNEL_API_KEY });
  const result = await client.browsers.playwright.execute(
    browserSessionId,
    {
      code: extensionRuntimeCode(operation, argument),
      timeout_sec: operation === "fill" ? 15 : 10,
    },
    { signal }
  );
  if (!result.success) {
    throw new Error(
      result.error ?? "The vault autofill extension did not respond."
    );
  }
  return result.result;
}

export function extensionRuntimeCode(
  operation: "fill" | "getPublicKey" | "inspect",
  argument?: string
) {
  const serializedArgument = JSON.stringify(argument);
  return `
const workers = context.serviceWorkers();
let vaultWorker;
for (const candidate of workers) {
  const ready = await candidate.evaluate(() => {
    const runtime = globalThis.eveVaultAutofillRuntime;
    return Boolean(runtime && typeof runtime.${operation} === "function");
  }).catch(() => false);
  if (ready) {
    vaultWorker = candidate;
    break;
  }
}
if (!vaultWorker) {
  throw new Error("The vault autofill extension is not active.");
}
return vaultWorker.evaluate(
  (argument) => globalThis.eveVaultAutofillRuntime.${operation}(argument),
  ${serializedArgument},
);`;
}
