import { getEnv } from "./runtime-env";

export type DeploymentMode = "hosted" | "local";

export function getDeploymentMode(environment?: {
  readonly LOCAL_VAULT_ASSISTANT_MODE?: string;
  readonly VERCEL?: string;
}): DeploymentMode {
  const resolved = environment ?? getEnv();
  const configured = resolved.LOCAL_VAULT_ASSISTANT_MODE?.trim();
  if (configured === "hosted" || configured === "local") return configured;
  if (configured) {
    throw new Error(
      'LOCAL_VAULT_ASSISTANT_MODE must be either "local" or "hosted".'
    );
  }

  return resolved.VERCEL === "1" ? "hosted" : "local";
}
