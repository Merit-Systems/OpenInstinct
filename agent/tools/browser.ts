import {
  defineDynamic,
  defineTool,
  toolOutput,
  toolOutputPart,
} from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import {
  browserLiveViewInputSchema,
  computerActionInputSchema,
  executePlaywrightInputSchema,
  manageBrowsersInputSchema,
} from "@/agent/extensions/kernel/browser-contract";
import {
  executeOwnedKernelComputerAction,
  executeOwnedKernelPlaywright,
  getOwnedKernelBrowserLiveView,
  manageOwnedKernelBrowsers,
} from "@/agent/extensions/kernel/browser-runtime";

const computerResultSchema = z.object({
  data: z.unknown().optional(),
  message: z.string(),
  mimeType: z.literal("image/png").optional(),
  screenshotBase64: z.string().optional(),
});

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
      if (!caller) return null;
      const scope = scopeFromPrincipal(caller);

      return {
        manage_browsers: defineTool({
          description:
            'Manage browser sessions. New sessions use Kernel stealth mode with its managed CAPTCHA solver. Create one browser with at least a 15-minute timeout and reuse it for the assignment; use "list" or "get" to inspect sessions and "delete" when finished. Keep a browser open only for a pending human action or transaction approval.',
          inputSchema: manageBrowsersInputSchema,
          execute: (input, context) =>
            manageOwnedKernelBrowsers(scope, input, context.abortSignal),
        }),
        get_browser_live_view: defineTool({
          description:
            "Get a signed live-view URL for an owned browser only when the user explicitly asks for browser access. Do not call this speculatively or for routine browser work.",
          inputSchema: browserLiveViewInputSchema,
          execute: (input, context) =>
            getOwnedKernelBrowserLiveView(
              scope,
              input.session_id,
              context.abortSignal
            ),
        }),
        execute_playwright_code: defineTool({
          description:
            'Execute Playwright/TypeScript automation code against an existing browser session with a 30-second ceiling. Batch related operations, use "domcontentloaded" or a precise locator with waits of at most five seconds, except for one managed CAPTCHA state wait of at most 20 seconds, and never wait for "networkidle" or use fixed multi-second sleeps. Does not create or delete browsers.',
          inputSchema: executePlaywrightInputSchema,
          execute: (input, context) =>
            executeOwnedKernelPlaywright(scope, input, context.abortSignal),
        }),
        computer_action: defineTool({
          description:
            "Execute a bounded batch of computer actions on one browser session. Prefer one batch over repeated calls, keep sleep actions at or below two seconds, and include a screenshot last only when visual inspection is needed; screenshots are delivered directly to the vision model.",
          inputSchema: computerActionInputSchema,
          execute: async (input, context) =>
            computerResultSchema.parse(
              await executeOwnedKernelComputerAction(
                scope,
                input,
                context.abortSignal
              )
            ),
          toModelOutput(output) {
            if (!output.screenshotBase64) {
              return toolOutput.json({
                data: output.data,
                message: output.message,
              });
            }
            return toolOutput.content([
              toolOutputPart.text(output.message),
              toolOutputPart.file(output.screenshotBase64, {
                mediaType: output.mimeType ?? "image/png",
              }),
            ]);
          },
        }),
      };
    },
  },
});
