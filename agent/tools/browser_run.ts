import Kernel from "@onkernel/sdk";
import { defineTool } from "eve/tools";
import { env } from "../../env.js";
import { browserRunInputSchema } from "../lib/kernel-browser.js";

export default defineTool({
  description:
    "Create or reuse a Kernel cloud browser and execute Playwright code in it. Return concise JSON from the code, reuse the returned sessionId for follow-up actions, and close the session when finished.",
  inputSchema: browserRunInputSchema,
  async execute({ code, sessionId, startUrl, stealth, timeoutSeconds }, ctx) {
    const kernel = new Kernel({ apiKey: env.KERNEL_API_KEY });
    const createdBrowser = sessionId
      ? undefined
      : await kernel.browsers.create(
          {
            headless: false,
            start_url: startUrl,
            stealth,
            tags: { "eve-session": ctx.session.id },
            timeout_seconds: 300,
          },
          { signal: ctx.abortSignal }
        );
    const activeSessionId = sessionId ?? createdBrowser?.session_id;

    if (!activeSessionId) {
      throw new Error("Kernel did not return a browser session ID.");
    }

    const execution = await kernel.browsers.playwright.execute(
      activeSessionId,
      { code, timeout_sec: timeoutSeconds },
      { signal: ctx.abortSignal }
    );

    return {
      sessionId: activeSessionId,
      liveViewUrl: createdBrowser?.browser_live_view_url,
      ...execution,
    };
  },
});
