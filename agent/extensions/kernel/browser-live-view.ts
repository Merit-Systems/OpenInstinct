import Kernel from "@onkernel/sdk";
import type { AccessScope } from "@/lib/access-scope";
import { env } from "@/lib/env";
import { requireOwnedBrowserSession } from "./browser-runtime";

export async function getOwnedKernelBrowserLiveView(
  scope: AccessScope,
  sessionId: string,
  signal?: AbortSignal
) {
  await requireOwnedBrowserSession(scope, sessionId);
  const browser = await new Kernel({
    apiKey: env.KERNEL_API_KEY,
  }).browsers.retrieve(sessionId, {}, { signal });
  if (!browser.browser_live_view_url) {
    throw new Error("The browser live view is unavailable.");
  }
  return {
    browser_live_view_url: browser.browser_live_view_url,
    session_id: browser.session_id,
  };
}
