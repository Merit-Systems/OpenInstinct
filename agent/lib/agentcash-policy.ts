import { isIP } from "node:net";
import { z } from "zod";

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Agentcash endpoints must use HTTPS.",
  })
  .refine((value) => publicEndpointHostname(new URL(value).hostname), {
    message: "Agentcash endpoints must use a public internet host.",
  });

function publicEndpointHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return false;
  }
  if (isIP(normalized) === 4) {
    const [first = 0, second = 0] = normalized
      .split(".")
      .map((part) => Number(part));
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (isIP(normalized) === 6) {
    return !/^(?:::|::1|f[cd][0-9a-f]*:|fe[89ab][0-9a-f]*:|ff[0-9a-f]*:|::ffff:(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.))/iu.test(
      normalized
    );
  }
  return true;
}

const safeHeadersSchema = z
  .record(z.string(), z.string())
  .default({})
  .superRefine((headers, ctx) => {
    const credentialHeader = Object.keys(headers).find((name) =>
      /^(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key)$/iu.test(
        name
      )
    );
    if (credentialHeader) {
      ctx.addIssue({
        code: "custom",
        message:
          "Agentcash requests cannot include credential headers; Agentcash provides wallet authentication and payment itself.",
      });
    }
  });

export const agentcashFetchSchema = z.object({
  body: z
    .union([z.string().max(250_000), z.record(z.string(), z.unknown())])
    .optional(),
  headers: safeHeadersSchema.optional(),
  maxAmount: z.number().positive().max(100),
  method: z.enum(["DELETE", "GET", "PATCH", "POST", "PUT"]).default("GET"),
  paymentNetwork: z.enum(["base", "solana", "tempo"]).optional(),
  paymentProtocol: z.enum(["mpp", "x402"]).optional(),
  timeout: z.number().int().positive().max(120_000).default(30_000),
  url: httpsUrlSchema,
});

export const agentcashFreeFetchSchema = agentcashFetchSchema.pick({
  headers: true,
  paymentNetwork: true,
  timeout: true,
  url: true,
});

const endpointInspectionSchema = z.object({
  results: z
    .array(
      z.object({
        authMode: z.string(),
        method: z.string(),
        requiresPayment: z.boolean(),
      })
    )
    .min(1),
  url: httpsUrlSchema,
});

export const agentcashNoPaymentCeilingUsd = Number.MIN_VALUE;

export function enforceAgentcashFetch(
  input: z.infer<typeof agentcashFetchSchema>,
  deploymentMaximumUsd: number
) {
  if (input.maxAmount > deploymentMaximumUsd) {
    throw new Error(
      `The requested Agentcash ceiling exceeds the $${deploymentMaximumUsd.toFixed(2)} deployment limit.`
    );
  }
  return input;
}

export function assertAgentcashFreeSiwxEndpoint(
  inspection: unknown,
  expectedUrl: string
) {
  const parsed = endpointInspectionSchema.safeParse(inspection);
  const isExactFreeGet =
    parsed.success &&
    parsed.data.url === expectedUrl &&
    parsed.data.results.every(
      (result) =>
        result.method === "GET" &&
        result.authMode.toLowerCase() === "siwx" &&
        !result.requiresPayment
    );
  if (!isExactFreeGet) {
    throw new Error(
      "Agentcash GET request is not confirmed as a free SIWX endpoint. Use agentcash_fetch with native payment approval instead."
    );
  }
}

export function safeAgentcashReadInput(
  toolName: string,
  input: Record<string, unknown>
) {
  if ("url" in input) httpsUrlSchema.parse(input.url);
  if ("headers" in input) safeHeadersSchema.parse(input.headers);
  if (toolName === "search") {
    if (
      typeof input.limit === "number" &&
      (input.limit < 1 || input.limit > 20)
    ) {
      throw new Error("Agentcash search limits must be between 1 and 20.");
    }
  }
  return input;
}
