import { type AccessScope, localAccessScope } from "./access-scope";
import { getEnv } from "./runtime-env";
import { getAppStore } from "./server/app-store";
import type { BrowserMode } from "./manager";

export async function getBrowserSettings(scope: AccessScope) {
  const store = await getAppStore();
  const configuredMode = await store.readBrowserMode(scope);
  const localAvailable = isLocalBrowserAvailable(scope);
  const cloudAvailable = Boolean(getEnv().KERNEL_API_KEY);

  return {
    cloudAvailable,
    localAvailable,
    mode: localAvailable ? (configuredMode ?? "local") : "cloud",
  } satisfies {
    readonly cloudAvailable: boolean;
    readonly localAvailable: boolean;
    readonly mode: BrowserMode;
  };
}

export function isLocalBrowserAvailable(scope: AccessScope = localAccessScope) {
  return (
    scope.mode === "local" &&
    process.platform === "darwin" &&
    !getEnv().VERCEL_REGION
  );
}

export async function selectBrowserMode(scope: AccessScope, mode: BrowserMode) {
  const settings = await getBrowserSettings(scope);
  if (mode === "local" && !settings.localAvailable) {
    throw new Error("Local browser execution is unavailable in the cloud.");
  }
  if (mode === "cloud" && !settings.cloudAvailable) {
    throw new Error(
      "Set KERNEL_API_KEY in the system environment before selecting the cloud browser."
    );
  }
  await (await getAppStore()).selectBrowserMode(scope, mode);
}
