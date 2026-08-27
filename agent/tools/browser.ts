import {
  defineDynamic,
  defineTool,
  toolOutput,
  toolOutputPart,
} from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "../../lib/access-scope.js";
import {
  computerActionInputSchema,
  executePlaywrightInputSchema,
  manageBrowsersInputSchema,
} from "../../lib/kernel-browser-contract.js";
import {
  executeOwnedKernelComputerAction,
  executeOwnedKernelPlaywright,
  manageOwnedKernelBrowsers,
} from "../../lib/server/kernel-browser.js";

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
            'Manage browser sessions. Use "create" before browser control, "list" or "get" to inspect sessions, and "delete" when finished.',
          inputSchema: manageBrowsersInputSchema,
          execute: (input, context) =>
            manageOwnedKernelBrowsers(scope, input, context.abortSignal),
        }),
        execute_playwright_code: defineTool({
          description:
            "Execute Playwright/TypeScript automation code against an existing browser session. Does not create or delete browsers; use manage_browsers for session lifecycle.",
          inputSchema: executePlaywrightInputSchema,
          execute: (input, context) =>
            executeOwnedKernelPlaywright(scope, input, context.abortSignal),
        }),
        computer_action: defineTool({
          description:
            "Execute computer actions on a browser session. Pass one or more mouse, keyboard, clipboard, sleep, or screenshot actions. Always include a screenshot as the last action when visual inspection is needed; screenshots are delivered directly to the vision model.",
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
