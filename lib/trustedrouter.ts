import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { env } from "./env";
import type { ModelCatalogItem } from "./model-catalog";

const DEFAULT_BASE_URL = "https://api.trustedrouter.com/v1";
const DEFAULT_MODEL_ID = "trustedrouter/auto";
const CATALOG_TTL_MS = 5 * 60 * 1000;

const catalogResponseSchema = z.object({
  data: z.array(
    z.object({
      context_length: z.number().int().nonnegative().optional(),
      id: z.string(),
      name: z.string(),
      pricing: z
        .object({
          completion: z.string().optional(),
          prompt: z.string().optional(),
        })
        .optional(),
      trustedrouter: z.object({
        provider: z.string(),
        supports_chat: z.boolean().optional(),
      }),
    })
  ),
});

export interface TrustedRouterConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

/**
 * TrustedRouter replaces the AI Gateway inference path when an API key is set.
 * Without the key the app keeps routing through the Vercel AI Gateway.
 */
export function getTrustedRouterConfig(): TrustedRouterConfig | undefined {
  const apiKey = env.TRUSTEDROUTER_API_KEY;
  if (apiKey === undefined) return;

  return { apiKey, baseUrl: env.TRUSTEDROUTER_BASE_URL ?? DEFAULT_BASE_URL };
}

export async function fetchTrustedRouterCatalog(
  config: TrustedRouterConfig
): Promise<readonly ModelCatalogItem[]> {
  const cached = catalogCache.get(config.baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.catalog;

  let response: Response;
  try {
    response = await fetch(new URL("models", `${config.baseUrl}/`), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  } catch (error) {
    // A transient catalog outage must not take inference down with it.
    if (cached) return cached.catalog;
    throw error;
  }
  if (!response.ok) {
    if (cached) return cached.catalog;
    throw new Error("The TrustedRouter model catalog is unavailable.");
  }

  const catalog = catalogResponseSchema
    .parse(await response.json())
    .data.filter(
      (model) =>
        model.trustedrouter.supports_chat === true &&
        model.context_length !== undefined &&
        model.context_length > 0
    )
    .map((model) => ({
      contextWindow: model.context_length,
      id: model.id,
      name: model.name,
      ownedBy: model.trustedrouter.provider,
      pricing: model.pricing
        ? {
            input: perMillion(model.pricing.prompt),
            output: perMillion(model.pricing.completion),
          }
        : undefined,
    }));

  catalogCache.set(config.baseUrl, {
    catalog,
    expiresAt: Date.now() + CATALOG_TTL_MS,
  });
  return catalog;
}

/**
 * eve resolves a context window from the AI Gateway catalog, which does not
 * list TrustedRouter models, so the selection has to carry its own window.
 */
export async function selectTrustedRouterModel(
  config: TrustedRouterConfig,
  modelId: string | undefined
): Promise<{
  readonly model: LanguageModel;
  readonly modelContextWindowTokens: number;
  readonly modelId: string;
}> {
  const selectedId = modelId ?? DEFAULT_MODEL_ID;
  const catalog = await fetchTrustedRouterCatalog(config);
  const entry = catalog.find((model) => model.id === selectedId);
  if (entry?.contextWindow === undefined) {
    throw new Error(
      `TrustedRouter does not offer a chat model named "${selectedId}".`
    );
  }

  const trustedRouter = createOpenAICompatible({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    name: "trustedrouter",
  });

  return {
    model: trustedRouter(selectedId),
    modelContextWindowTokens: entry.contextWindow,
    modelId: selectedId,
  };
}

const catalogCache = new Map<
  string,
  { readonly catalog: readonly ModelCatalogItem[]; readonly expiresAt: number }
>();

function perMillion(value: string | undefined) {
  if (value === undefined) return;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}
