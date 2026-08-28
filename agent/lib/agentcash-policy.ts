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
