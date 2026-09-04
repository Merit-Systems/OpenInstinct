import type { z } from "zod";
import { saveProactionPolicy } from "@/db/services/proaction-policies";
import { saveProactionSettings } from "@/db/services/proaction-settings";
import type { AccessScope } from "@/lib/access-scope";
import { proactionById } from "./catalog";
import type {
  proactionPolicyPatchSchema,
  proactionSettingsPatchSchema,
} from "./define";
import { reconcileProactions } from "./reconcile";

// Shared by the chat tools and the web API: persist a user choice, then bring
// the system jobs in line with it.
export async function configureProaction(
  scope: AccessScope,
  proactionId: string,
  patch: z.infer<typeof proactionPolicyPatchSchema>
) {
  if (!proactionById(proactionId)) throw new Error("Unknown proaction.");
  await saveProactionPolicy(scope, proactionId, patch);
  const entry = (await reconcileProactions(scope)).entries.find(
    (candidate) => candidate.definition.id === proactionId
  );
  if (!entry) throw new Error("Unknown proaction.");
  return entry;
}

export async function updateProactionSettings(
  scope: AccessScope,
  patch: z.infer<typeof proactionSettingsPatchSchema>
) {
  const settings = await saveProactionSettings(scope, patch);
  await reconcileProactions(scope);
  return settings;
}
