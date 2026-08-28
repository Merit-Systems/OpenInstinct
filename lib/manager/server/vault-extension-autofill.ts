import { CompactEncrypt, importJWK, type JWK } from "jose";
import { z } from "zod";
import { kernel } from "@/lib/kernel";
import type {
  AutofillClaim,
  VaultAutofillCommand,
} from "../vault-autofill-protocol";
import {
  autofillInspectionSchema,
  vaultAutofillExtensionResultSchema,
} from "../vault-autofill-protocol";

const keyExchangeSchema = z.object({
  browserNow: z.number().int().nonnegative(),
  publicKey: z.object({
    e: z.string().min(1),
    kty: z.literal("RSA"),
    n: z.string().min(1),
  }),
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
  const keyExchange = keyExchangeSchema.parse(
    await executeExtensionOperation(
      browserSessionId,
      "getPublicKey",
      undefined,
      signal
    )
  );
  const publicKey = await importJWK(
    keyExchange.publicKey as JWK,
    "RSA-OAEP-256"
  );
  const now = keyExchange.browserNow;
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
  const result = await kernel.browsers.playwright.execute(
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
  const operationExpression = `globalThis.vaultAutofillContentRuntime[${JSON.stringify(operation)}](${serializedArgument})`;
  const runtimeExpression =
    operation === "getPublicKey"
      ? `Promise.resolve(${operationExpression}).then((publicKey) => ({ browserNow: Date.now(), publicKey }))`
      : operationExpression;
  return `
const activePage = context.pages().at(-1);
if (!activePage) {
  throw new Error("No active browser tab was found.");
}
const cdpSession = await context.newCDPSession(activePage);
try {
  const executionContexts = [];
  cdpSession.on("Runtime.executionContextCreated", ({ context: executionContext }) => {
    if (executionContext.auxData?.type === "isolated") {
      executionContexts.push(executionContext);
    }
  });
  await cdpSession.send("Runtime.enable");

  let runtimeContext;
  for (const executionContext of executionContexts) {
    const probe = await cdpSession.send("Runtime.evaluate", {
      contextId: executionContext.id,
      expression: "Boolean(globalThis.vaultAutofillContentRuntime)",
      returnByValue: true,
    }).catch(() => undefined);
    if (probe?.result.value === true) {
      runtimeContext = executionContext;
      break;
    }
  }

  if (!runtimeContext) {
    throw new Error("The vault autofill extension is not active.");
  }
  const response = await cdpSession.send("Runtime.evaluate", {
    awaitPromise: true,
    contextId: runtimeContext.id,
    expression: ${JSON.stringify(runtimeExpression)},
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "The vault autofill extension did not respond."
    );
  }
  return response.result.value;
} finally {
  await cdpSession.detach().catch(() => undefined);
}`;
}
