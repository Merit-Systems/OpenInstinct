import type { VaultAutofillFrameInspection } from "../../lib/manager/vault-autofill-protocol";

export function isAutofillFrame(
  inspection: VaultAutofillFrameInspection | null
) {
  return Boolean(inspection?.surfaces.length);
}
