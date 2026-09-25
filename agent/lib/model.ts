import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { env } from "@shared/environment";
import { directGeminiModelId } from "@shared/model/selection";

export function resolveSelectedModel(modelId: string) {
  if (modelId !== directGeminiModelId) return modelId;

  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is required for the direct Gemini model."
    );
  }

  return {
    model: createGoogleGenerativeAI({ apiKey })("gemini-3.5-flash-lite"),
    modelContextWindowTokens: 1_048_576,
  };
}
