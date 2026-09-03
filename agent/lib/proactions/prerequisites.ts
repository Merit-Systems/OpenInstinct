import { listVaultItems } from "@/db/services/vault";
import type { AccessScope } from "@/lib/access-scope";
import { readGoogleWorkspaceConnection } from "@/lib/google-workspace";
import type { ProactionDefinition, ProactionRequirement } from "./define";

export interface ProactionReadiness {
  readonly missing: readonly ProactionRequirement[];
  readonly ready: boolean;
}

// Resolves each requirement once per reconcile, so a catalog of many
// proactions costs one Google token check and one vault read.
export async function proactionPrerequisiteChecker(scope: AccessScope) {
  const cache = new Map<ProactionRequirement, Promise<boolean>>();
  const check = (requirement: ProactionRequirement) => {
    let pending = cache.get(requirement);
    if (!pending) {
      pending = resolveRequirement(scope, requirement);
      cache.set(requirement, pending);
    }
    return pending;
  };
  return async (
    definition: ProactionDefinition
  ): Promise<ProactionReadiness> => {
    const results = await Promise.all(
      definition.requires.map(async (requirement) => ({
        requirement,
        satisfied: await check(requirement),
      }))
    );
    const missing = results
      .filter((result) => !result.satisfied)
      .map((result) => result.requirement);
    return { missing, ready: missing.length === 0 };
  };
}

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

function resolveRequirement(
  scope: AccessScope,
  requirement: ProactionRequirement
) {
  return requirementChecks[requirement](scope);
}

const missingRequirementLabels: Record<ProactionRequirement, string> = {
  browser: "Needs a browser",
  google: "Needs Google",
  paymentCard: "Needs a saved card",
};

export function describeMissingRequirement(requirement: ProactionRequirement) {
  return missingRequirementLabels[requirement];
}
