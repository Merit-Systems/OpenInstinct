import { listVaultItems } from "@/db/services/vault";
import type { AccessScope } from "@/lib/access-scope";
import { readGoogleWorkspaceConnection } from "@/lib/google-workspace";
import type { ProactionDefinition, ProactionRequirement } from "./define";

const requirementChecks: Record<
  ProactionRequirement,
  (scope: AccessScope) => Promise<boolean>
> = {
  // KERNEL_API_KEY is validated at boot by src/env.ts.
  browser: () => Promise.resolve(true),
  google: async (scope) =>
    (await readGoogleWorkspaceConnection(scope.userId)).state === "connected",
  paymentCard: async (scope) =>
    (await listVaultItems(scope)).some((item) => item.kind === "payment"),
};

// Resolves every requirement once per reconcile, so a catalog of many
// proactions costs one Google token check and one vault read.
export async function proactionPrerequisiteChecker(scope: AccessScope) {
  const entries = await Promise.all(
    Object.entries(requirementChecks).map(
      async ([requirement, check]) => [requirement, await check(scope)] as const
    )
  );
  const satisfied = new Set(
    entries.filter(([, ready]) => ready).map(([requirement]) => requirement)
  );
  return (definition: ProactionDefinition) => {
    const missing = definition.requires.filter(
      (requirement) => !satisfied.has(requirement)
    );
    return { missing, ready: missing.length === 0 };
  };
}

const missingRequirementLabels: Record<ProactionRequirement, string> = {
  browser: "Needs a browser",
  google: "Needs Google",
  paymentCard: "Needs a saved card",
};

export function describeMissingRequirement(requirement: ProactionRequirement) {
  return missingRequirementLabels[requirement];
}
