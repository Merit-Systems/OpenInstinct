import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getInstallationSecrets } from "@/lib/installation-secrets";

const automationRequestSchema = z.object({
  automationId: z.string().min(1),
  purpose: z.enum(["arm", "execute"]),
  revision: z.coerce.number().int().positive(),
  runId: z.string().min(1).optional(),
  timestamp: z.coerce.number().int().positive(),
});

const maximumSignatureAgeMilliseconds = 5 * 60 * 1000;

export async function createAutomationRequestHeaders(input: {
  readonly automationId: string;
  readonly purpose: "arm" | "execute";
  readonly revision: number;
  readonly runId?: string;
}) {
  if (input.purpose === "execute" && !input.runId) {
    throw new Error("Automation execution signatures require a run ID.");
  }
  const timestamp = Date.now();
  const request = { ...input, timestamp };
  const headers = {
    "x-openinstinct-automation-id": input.automationId,
    "x-openinstinct-automation-purpose": input.purpose,
    "x-openinstinct-automation-revision": String(input.revision),
    "x-openinstinct-automation-signature": await signAutomationRequest(request),
    "x-openinstinct-automation-timestamp": String(timestamp),
  };
  if (input.runId) {
    Object.assign(headers, {
      "x-openinstinct-automation-run-id": input.runId,
    });
  }
  return headers;
}

export async function verifyAutomationRequest(
  headers: Headers,
  expectedPurpose: "arm" | "execute"
) {
  const parsed = automationRequestSchema.safeParse({
    automationId: headers.get("x-openinstinct-automation-id"),
    purpose: headers.get("x-openinstinct-automation-purpose"),
    revision: headers.get("x-openinstinct-automation-revision"),
    runId: headers.get("x-openinstinct-automation-run-id") ?? undefined,
    timestamp: headers.get("x-openinstinct-automation-timestamp"),
  });
  if (
    !parsed.success ||
    parsed.data.purpose !== expectedPurpose ||
    (expectedPurpose === "execute" && !parsed.data.runId)
  )
    return undefined;
  if (
    Math.abs(Date.now() - parsed.data.timestamp) >
    maximumSignatureAgeMilliseconds
  ) {
    return undefined;
  }

  const signature = headers.get("x-openinstinct-automation-signature");
  if (!signature) return undefined;
  const expected = await signAutomationRequest(parsed.data);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return undefined;
  }
  return parsed.data;
}

async function signAutomationRequest(input: {
  readonly automationId: string;
  readonly purpose: "arm" | "execute";
  readonly revision: number;
  readonly runId?: string;
  readonly timestamp: number;
}) {
  const { betterAuthSecret } = await getInstallationSecrets();
  return createHmac("sha256", betterAuthSecret)
    .update(
      [
        input.purpose,
        input.automationId,
        input.revision,
        input.runId ?? "",
        input.timestamp,
      ].join("\0")
    )
    .digest("hex");
}
