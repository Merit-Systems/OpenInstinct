import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "../../lib/access-scope.js";
import { requireOwnedBrowserSession } from "../../lib/server/kernel-browser.js";
import { listAutofillSuggestions } from "../../lib/server/vault-autofill.js";
import { vaultAutofillProvider } from "../../lib/server/vault-autofill-provider.js";
import { inspectWithVaultExtension } from "../../lib/server/vault-extension-autofill.js";
import { inspectAutofillRequestSchema } from "../../lib/vault-autofill.js";
import {
  autofillSurfaceKindSchema,
  autofillSuggestionSchema,
} from "../../lib/vault-autofill-protocol.js";

const outputSchema = z.object({
  origin: z.string(),
  surfaces: z.array(
    z.object({
      kind: autofillSurfaceKindSchema,
      suggestions: z.array(autofillSuggestionSchema),
      surfaceId: z.string(),
    })
  ),
});

export default defineTool({
  description:
    "Inspect the active browser for login, payment, address, contact, identity, or secret-entry forms and return compatible saved items as masked suggestions. Call this before fill_from_vault. It never returns secret values or page selectors.",
  inputSchema: inspectAutofillRequestSchema,
  outputSchema,
  async execute(input, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);

    await requireOwnedBrowserSession(scope, input.browserSessionId);
    const inspection = await inspectWithVaultExtension({
      browserSessionId: input.browserSessionId,
      signal: context.abortSignal,
    });
    const surfaces = await Promise.all(
      inspection.surfaces.map(async (surface) => ({
        kind: surface.kind,
        suggestions: [
          ...(await listAutofillSuggestions(
            scope,
            inspection.origin,
            surface,
            vaultAutofillProvider
          )),
        ],
        surfaceId: surface.id,
      }))
    );

    return { origin: inspection.origin, surfaces };
  },
});
