import { defineDynamic, defineTool } from "eve/tools";
import { getBrowserSettings } from "../../lib/browser-config.js";
import {
  localBrowserActionSchema,
  runLocalBrowserAction,
} from "../../lib/local-browser.js";

export default defineDynamic({
  events: {
    "step.started": async () => {
      if ((await getBrowserSettings()).mode !== "local") return null;

      return defineTool({
        description:
          "Control the browser running visibly on this device. Open pages, inspect visible text and interactive element references, click, fill non-secret fields, press keys, scroll, go back, or close it. Inspect again after navigation or a major page update to refresh element references. Password fields reject ordinary fill; credentials must use the trusted local vault flow.",
        inputSchema: localBrowserActionSchema,
        execute: (input, context) =>
          runLocalBrowserAction(input, context.abortSignal),
      });
    },
  },
});
