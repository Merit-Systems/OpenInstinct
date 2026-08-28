import { defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { kernel } from "@/lib/kernel";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";

const defaultTimeoutSeconds = 12;
const captchaTimeoutSeconds = 25;
const modelResultCharacterLimit = 12_000;
const modelLogCharacterLimit = 2_000;

const inputSchema = z.object({
  code: z.string().min(1),
  session_id: z.string().min(1),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(captchaTimeoutSeconds)
    .optional(),
});

const outputSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  result: z.unknown().optional(),
  stderr: z.string().optional(),
  stdout: z.string().optional(),
});

export default defineTool({
  description:
    'Execute one bounded Playwright/TypeScript program against an existing browser session. Prefer one program per page state that inspects, performs all related safe actions, verifies the outcome, and returns one compact object. The default ceiling is 12 seconds; set timeout_seconds to 25 only for one managed CAPTCHA wait of at most 20 seconds. Use "domcontentloaded" or precise locator waits of at most five seconds, and never wait for "networkidle" or use fixed multi-second sleeps. Does not create or delete browsers.',
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);
    return outputSchema.parse(
      await kernel.browsers.playwright.execute(
        input.session_id,
        {
          code: input.code,
          timeout_sec: input.timeout_seconds ?? defaultTimeoutSeconds,
        },
        { signal: context.abortSignal }
      )
    );
  },
  toModelOutput(output) {
    const value: Record<string, unknown> = { success: output.success };
    if (output.error) {
      value.error = truncate(output.error, modelLogCharacterLimit);
    }
    if (output.result !== undefined) {
      value.result = boundedResult(output.result);
    }
    if (output.stderr) {
      value.stderr = truncate(output.stderr, modelLogCharacterLimit);
    }
    if (output.stdout) {
      value.stdout = truncate(output.stdout, modelLogCharacterLimit);
    }
    return toolOutput.json(value);
  },
});

function boundedResult(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= modelResultCharacterLimit) {
    return value;
  }
  return {
    characterCount: serialized.length,
    preview: serialized.slice(0, modelResultCharacterLimit),
    truncated: true,
  };
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${String(value.length - limit)} characters]`;
}
