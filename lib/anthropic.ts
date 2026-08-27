import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "@/lib/env";
import { createDirectHaikuSelection } from "@/lib/model-config";

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export function createHaikuModelSelection() {
  return createDirectHaikuSelection(anthropic("claude-haiku-4-5"));
}
