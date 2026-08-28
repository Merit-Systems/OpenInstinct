import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { listAutofillSuggestions } from "@/lib/manager/server/vault-autofill";
import { vaultAutofillProvider } from "@/lib/manager/server/vault-autofill-provider";
import { inspectWithVaultExtension } from "@/lib/manager/server/vault-extension-autofill";
import { inspectAutofillRequestSchema } from "@/lib/manager/vault-autofill";
import {
  autofillSurfaceKindSchema,
  autofillSuggestionSchema,
} from "@/lib/manager/vault-autofill-protocol";

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
    const scope = await requireWorkerScope(context);

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
