import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { materializeAutofillClaims } from "@/lib/manager/server/vault-autofill";
import { vaultAutofillProvider } from "@/lib/manager/server/vault-autofill-provider";
import {
  fillWithVaultExtension,
  inspectWithVaultExtension,
} from "@/lib/manager/server/vault-extension-autofill";
import { fillFromVaultRequestSchema } from "@/lib/manager/vault-autofill";

const outputSchema = z.object({
  filledClaims: z.number().int().nonnegative(),
  origin: z.string(),
  success: z.literal(true),
  surfaceId: z.string(),
});

export default defineTool({
  description:
    "Fill one detected browser form using a candidate returned by inspect_autofill. Pass only its opaque surfaceId and candidateId; never supply vault field names, selectors, frame origins, or secret values. The vault adapter releases the selected item directly to the private extension, which discovers and fills the actual controls across approved frames.",
  inputSchema: fillFromVaultRequestSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);

    await requireOwnedBrowserSession(scope, input.browserSessionId);
    const inspection = await inspectWithVaultExtension({
      browserSessionId: input.browserSessionId,
      signal: context.abortSignal,
    });
    const surface = inspection.surfaces.find(
      ({ id }) => id === input.surfaceId
    );
    if (!surface) {
      throw new Error(
        "The selected autofill surface is no longer present. Inspect the page again."
      );
    }

    const claims = await materializeAutofillClaims(
      scope,
      input.candidateId,
      {
        availableTokens: new Set(surface.fields.map(({ token }) => token)),
        origin: inspection.origin,
        surface,
      },
      vaultAutofillProvider
    );
    const result = await fillWithVaultExtension({
      browserSessionId: input.browserSessionId,
      claims,
      expectedOrigin: inspection.origin,
      signal: context.abortSignal,
      surfaceId: surface.id,
    });
    if (!result.success) {
      const counts = { filled: 0, missing: 0, rejected: 0 };
      for (const { status } of result.claims) counts[status] += 1;
      throw new Error(
        `Secure vault autofill was incomplete (${String(counts.filled)} filled, ${String(counts.missing)} missing, ${String(counts.rejected)} rejected).`
      );
    }

    return {
      filledClaims: result.claims.length,
      origin: result.origin,
      success: true as const,
      surfaceId: result.surfaceId,
    };
  },
});
