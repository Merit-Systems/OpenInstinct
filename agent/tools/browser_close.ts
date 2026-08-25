import Kernel from "@onkernel/sdk";
import { defineTool } from "eve/tools";
import { env } from "../../env.js";
import { browserCloseInputSchema } from "../lib/kernel-browser.js";

export default defineTool({
  description:
    "Close a Kernel browser session after the browser task is complete.",
  inputSchema: browserCloseInputSchema,
  async execute({ sessionId }, ctx) {
    const kernel = new Kernel({ apiKey: env.KERNEL_API_KEY });
    await kernel.browsers.deleteByID(sessionId, { signal: ctx.abortSignal });
    return { closed: true, sessionId };
  },
});
