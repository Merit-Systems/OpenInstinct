import { z } from "zod";

export const browserRunInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe(
      "Playwright TypeScript/JavaScript to execute. page, context, and browser are available; return a JSON-serializable result."
    ),
  sessionId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "An existing Kernel browser session to reuse. Omit to create one."
    ),
  startUrl: z
    .url()
    .optional()
    .describe(
      "An optional initial URL used only when creating a browser session."
    ),
  stealth: z
    .boolean()
    .default(false)
    .describe("Use Kernel stealth mode when creating a browser session."),
  timeoutSeconds: z
    .int()
    .min(10)
    .max(300)
    .default(60)
    .describe("Maximum time for the Playwright execution."),
});

export const browserCloseInputSchema = z.object({
  sessionId: z.string().min(1).describe("The Kernel browser session to close."),
});
