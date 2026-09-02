import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";

const operationSchema = z.object({
  createdAt: z.iso.datetime(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  result: z.unknown().optional(),
  state: z.enum(["started", "succeeded", "uncertain"]),
  updatedAt: z.iso.datetime(),
});

export async function executeAgentcashPayment(input: {
  readonly callId: string;
  readonly operation: () => Promise<unknown>;
  readonly scope: AccessScope;
  readonly toolInput: Record<string, unknown>;
}) {
  const path = operationPath(input.scope, input.callId);
  const inputHash = hashCanonical(input.toolInput);
  const existing = await readOperation(path);
  if (existing) return existingResult(existing, inputHash);

  const now = new Date().toISOString();
  try {
    await writeOperation(
      path,
      { createdAt: now, inputHash, state: "started", updatedAt: now },
      false
    );
  } catch {
    const raced = await readOperation(path);
    if (raced) return existingResult(raced, inputHash);
    throw new Error(
      "The Agentcash payment safety receipt could not be created."
    );
  }

  let result: unknown;
  try {
    result = await input.operation();
  } catch (error) {
    await writeOperation(
      path,
      {
        createdAt: now,
        inputHash,
        state: "uncertain",
        updatedAt: new Date().toISOString(),
      },
      true
    ).catch(() => undefined);
    throw error;
  }

  try {
    await writeOperation(
      path,
      {
        createdAt: now,
        inputHash,
        result,
        state: "succeeded",
        updatedAt: new Date().toISOString(),
      },
      true
    );
  } catch {
    console.warn(
      "Agentcash completed a payment but could not persist its success receipt; do not retry this call automatically."
    );
  }
  return result;
}

function existingResult(
  operation: z.infer<typeof operationSchema>,
  inputHash: string
): unknown {
  if (operation.inputHash !== inputHash) {
    throw new Error(
      "This Agentcash tool-call identity conflicts with a different request. Start a new request."
    );
  }
  if (operation.state === "succeeded" && operation.result !== undefined) {
    return operation.result;
  }
  throw new Error(
    "This Agentcash payment was already attempted and its completion is uncertain. Do not repay; inspect the provider or wallet history first."
  );
}

function operationPath(scope: AccessScope, callId: string) {
  const owner = createHash("sha256")
    .update(`${scope.workspaceId}\0${scope.userId}`)
    .digest("hex");
  const operation = createHash("sha256").update(callId).digest("hex");
  return `agentcash-operations/${owner}/${operation}.json`;
}

function hashCanonical(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  throw new Error("The Agentcash request contains a non-JSON value.");
}

async function readOperation(path: string) {
  const result = await get(path, {
    access: "private",
  });
  if (result?.statusCode !== 200) return undefined;
  const serialized = await new Response(result.stream).text();
  if (serialized.length > 256_000) return undefined;
  return operationSchema.parse(JSON.parse(serialized));
}

async function writeOperation(
  path: string,
  operation: z.input<typeof operationSchema>,
  allowOverwrite: boolean
) {
  await put(path, JSON.stringify(operationSchema.parse(operation)), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite,
    contentType: "application/json",
    maximumSizeInBytes: 256_000,
  });
}
