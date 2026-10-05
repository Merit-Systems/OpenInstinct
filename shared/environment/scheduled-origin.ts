import { readFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "./env";
import { applicationOrigin } from "./origin";

const eveDevServerSchema = z.object({
  appRoot: z.string(),
  origin: z.url(),
});

export async function scheduledRunOrigin() {
  if (env.VERCEL_ENV && env.VERCEL_URL) {
    return `https://${env.VERCEL_URL}`;
  }
  if (env.NODE_ENV === "development") {
    try {
      const registry = eveDevServerSchema.parse(
        JSON.parse(await readFile(".eve/next-dev-server.json", "utf8"))
      );
      if (registry.appRoot === process.cwd()) {
        return new URL(registry.origin).origin;
      }
    } catch {
      // Standalone development does not create the Next.js server registry.
    }
  }
  return (
    env.SCHEDULED_RUN_ORIGIN ??
    (env.NODE_ENV === "production"
      ? "http://127.0.0.1:4274"
      : applicationOrigin())
  );
}

export async function scheduledWakeupOrigin() {
  if (env.VERCEL_ENV === "production") {
    if (!env.VERCEL_PROJECT_PRODUCTION_URL)
      throw new Error(
        "Production scheduled wakeups require VERCEL_PROJECT_PRODUCTION_URL."
      );
    return "https://" + env.VERCEL_PROJECT_PRODUCTION_URL;
  }
  return scheduledApplicationOrigin();
}

export function scheduledApplicationOrigin() {
  return env.VERCEL_ENV && env.VERCEL_URL
    ? "https://" + env.VERCEL_URL
    : applicationOrigin();
}
