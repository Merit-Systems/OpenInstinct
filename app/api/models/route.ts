import { z } from "zod";
import { modelCatalogSchema } from "@/app/_lib/model-catalog";

const gatewayResponseSchema = z.object({
  data: z.array(
    z.object({
      context_window: z.number().int().nonnegative().optional(),
      id: z.string(),
      name: z.string(),
      owned_by: z.string(),
      pricing: z
        .object({
          input: z.string().optional(),
          output: z.string().optional(),
        })
        .optional(),
      supported_parameters: z.array(z.string()).optional(),
      type: z.string().optional(),
    })
  ),
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("The model catalog is unavailable.");

    const catalog = gatewayResponseSchema.parse(await response.json());
    return Response.json(
      modelCatalogSchema.parse(
        catalog.data
          .filter(
            (model) =>
              model.type === "language" &&
              model.supported_parameters?.includes("tools")
          )
          .map((model) => ({
            contextWindow: model.context_window,
            id: model.id,
            name: model.name,
            ownedBy: model.owned_by,
            pricing: model.pricing
              ? {
                  input: perMillion(model.pricing.input),
                  output: perMillion(model.pricing.output),
                }
              : undefined,
          }))
      ),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The model catalog is unavailable.",
      },
      { status: 502 }
    );
  }
}

function perMillion(value: string | undefined) {
  if (value === undefined) return;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}
