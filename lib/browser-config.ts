import { getEnv } from "./runtime-env";
import { getAppStore } from "./server/database";
import type { BrowserMode } from "./manager";

export async function getBrowserSettings() {
  const store = await getAppStore();
  const configuredMode = await store.readBrowserMode();
  const localAvailable = isLocalBrowserAvailable();
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

export function isLocalBrowserAvailable() {
  return process.platform === "darwin" && !getEnv().VERCEL_REGION;
}

export async function selectBrowserMode(mode: BrowserMode) {
  const settings = await getBrowserSettings();
  if (mode === "local" && !settings.localAvailable) {
    throw new Error("Local browser execution is unavailable in the cloud.");
  }
  if (mode === "cloud" && !settings.cloudAvailable) {
    throw new Error(
      "Set KERNEL_API_KEY in the system environment before selecting the cloud browser."
    );
  }
  await (await getAppStore()).selectBrowserMode(mode);
}
