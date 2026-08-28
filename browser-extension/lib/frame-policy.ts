import type { VaultAutofillFrameInspection } from "../../lib/manager/vault-autofill-protocol";

export function permittedFrameInspection(
  expectedOrigin: string,
  inspection: VaultAutofillFrameInspection | null
) {
  if (!inspection?.surfaces.length) return null;
  if (inspection.origin === expectedOrigin) return inspection;

  const surfaces = inspection.surfaces.filter(
    ({ kind }) => kind === "payment-card"
  );
  return surfaces.length > 0 ? { ...inspection, surfaces } : null;
}
