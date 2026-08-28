import type { VaultAutofillFrameInspection } from "../../lib/vault-autofill-protocol";

export function isAutofillFrame(
  inspection: VaultAutofillFrameInspection | null
) {
  return Boolean(inspection?.surfaces.length);
}
