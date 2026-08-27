import Kernel from "@onkernel/sdk";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "../../lib/access-scope.js";
import { getBrowserSettings } from "../../lib/browser-config.js";
import { runLocalVaultAutofill } from "../../lib/local-browser.js";
import { getEnv } from "../../lib/runtime-env.js";
import { requireOwnedBrowserSession } from "../../lib/server/kernel-browser.js";
import { prepareVaultAutofill } from "../../lib/server/vault-autofill.js";
import { vaultAutofillRequestSchema } from "../../lib/vault-autofill.js";

const outputSchema = z.object({
  filledFields: z.array(z.string()),
  origin: z.string(),
  success: z.literal(true),
});

export default defineTool({
  description:
    "Fill saved fields in the active browser directly from an opaque local-vault handle without requesting another approval. Secret values are read inside trusted device code and are never returned to the model. Inspect the page first, pass the exact current origin, browser session ID, and precise CSS selectors. Never use this to expose, inspect, or copy a secret.",
  inputSchema: vaultAutofillRequestSchema,
  outputSchema,
  async execute(input, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);
    const browser = await getBrowserSettings(scope);
    if (!input.browserSessionId) {
      throw new Error(
        "A browser session ID is required for secure vault autofill."
      );
    }

    const resolved = await prepareVaultAutofill(
      scope,
      input.vaultItemId,
      input.fields.map(({ field }) => field)
    );
    const fields = input.fields.map((target, index) => {
      const value = resolved.at(index)?.value;
      if (value === undefined) {
        throw new Error("The vault fields could not be prepared.");
      }
      return { ...target, value };
    });

    if (browser.mode === "local") {
      await runLocalVaultAutofill(
        { expectedOrigin: input.expectedOrigin, fields },
        context.abortSignal
      );
    } else {
      await requireOwnedBrowserSession(scope, input.browserSessionId);
      await fillKernelBrowser({
        browserSessionId: input.browserSessionId,
        expectedOrigin: input.expectedOrigin,
        fields,
        signal: context.abortSignal,
      });
    }

    return {
      filledFields: resolved.map(({ field }) => field),
      origin: input.expectedOrigin,
      success: true as const,
    };
  },
});

async function fillKernelBrowser({
  browserSessionId,
  expectedOrigin,
  fields,
  signal,
}: {
  readonly browserSessionId: string;
  readonly expectedOrigin: string;
  readonly fields: readonly (z.infer<
    typeof vaultAutofillRequestSchema
  >["fields"][number] & { readonly value: string })[];
  readonly signal?: AbortSignal;
}) {
  const apiKey = getEnv().KERNEL_API_KEY;
  if (!apiKey) {
    throw new Error("The browser runtime is unavailable.");
  }

  const payload = JSON.stringify({ expectedOrigin, fields });
  const code = `
const payload = ${payload};
const currentOrigin = new URL(page.url()).origin;
if (currentOrigin !== payload.expectedOrigin) {
  throw new Error("The active page does not match the approved origin.");
}
for (const field of payload.fields) {
  const root = field.frameSelector ? page.frameLocator(field.frameSelector) : page;
  const element = root.locator(field.selector).first();
  await element.waitFor({ state: "visible", timeout: 10000 });
  if (!(await element.isEditable())) {
    throw new Error("An approved target is not editable.");
  }
  await element.fill(field.value);
  await element.evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.dataset.vaultSecret = "true";
    }
  });
}
return {
  filledFields: payload.fields.map(({ field }) => field),
  origin: currentOrigin,
  success: true,
};`;

  try {
    const result = await new Kernel({ apiKey }).browsers.playwright.execute(
      browserSessionId,
      { code, timeout_sec: 30 },
      { signal }
    );
    if (!result.success)
      throw new Error("The browser rejected vault autofill.");
  } catch {
    throw new Error(
      "Secure vault fill failed. Check that the browser is open on the approved site."
    );
  }
}
