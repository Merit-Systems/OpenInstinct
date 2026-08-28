import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnedBrowserSession } from "@/agent/extensions/kernel/browser-runtime";
import { readVaultItem } from "@/db/services/vault";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { materializeAutofillClaims } from "@/lib/manager/server/vault-autofill";
import { vaultAutofillProvider } from "@/lib/manager/server/vault-autofill-provider";
import {
  currentKernelPageOrigin,
  fillWithKernelNativeAutofill,
  nativeAutofillTokens,
} from "@/lib/manager/server/kernel-native-autofill";
import { fillFromVaultRequestSchema } from "@/lib/manager/vault-autofill";

const outputSchema = z.object({
  filledClaims: z.number().int().nonnegative(),
  kind: z.enum(["address", "payment"]),
  origin: z.string(),
  success: z.literal(true),
});

export default defineTool({
  description:
    "Fill a card or address form with an opaque handle returned by list_vault. Chromium tries the focused field first, then standard autocomplete controls, then other visible controls. Never supply vault fields, selectors, origins, or secret values.",
  inputSchema: fillFromVaultRequestSchema,
  outputSchema,
  async execute(input, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const scope = scopeFromPrincipal(caller);

    await requireOwnedBrowserSession(scope, input.browserSessionId);
    const item = await readVaultItem(scope, input.candidateId);
    if (!item) throw new Error("The selected vault item was not found.");
    if (item.kind !== "address" && item.kind !== "payment") {
      throw new Error(
        "Native Chromium autofill currently supports only cards and addresses."
      );
    }

    const origin = await currentKernelPageOrigin({
      browserSessionId: input.browserSessionId,
      signal: context.abortSignal,
    });
    const surfaceKind =
      item.kind === "payment" ? "payment-card" : "postal-address";
    const tokens = nativeAutofillTokens[item.kind];
    const surface = {
      fields: tokens.map((token) => ({ score: 100, token })),
      id: surfaceKind,
      kind: surfaceKind,
    };

    const claims = await materializeAutofillClaims(
      scope,
      input.candidateId,
      {
        availableTokens: new Set(tokens),
        origin,
        surface,
      },
      vaultAutofillProvider
    );
    const result = await fillWithKernelNativeAutofill({
      browserSessionId: input.browserSessionId,
      claims,
      expectedOrigin: origin,
      kind: item.kind,
      signal: context.abortSignal,
    });

    return {
      filledClaims: result.filledClaims,
      kind: item.kind,
      origin: result.origin,
      success: true as const,
    };
  },
});
