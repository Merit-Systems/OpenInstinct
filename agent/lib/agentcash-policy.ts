import { z } from "zod";

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Agentcash endpoints must use HTTPS.",
  });

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
