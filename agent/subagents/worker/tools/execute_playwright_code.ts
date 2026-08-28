import { defineTool } from "eve/tools";
import { z } from "zod";
import { kernel } from "@/lib/kernel";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";

const inputSchema = z.object({
  code: z.string().min(1),
  session_id: z.string().min(1),
});

export default defineTool({
  description:
    'Execute Playwright/TypeScript automation code against an existing browser session with a 30-second ceiling. Batch related operations, use "domcontentloaded" or a precise locator with waits of at most five seconds except for one managed CAPTCHA wait of at most 20 seconds, and never wait for "networkidle" or use fixed multi-second sleeps. Does not create or delete browsers.',
  inputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);
    return kernel.browsers.playwright.execute(
      input.session_id,
      { code: input.code, timeout_sec: 30 },
      { signal: context.abortSignal }
    );
  },
});
