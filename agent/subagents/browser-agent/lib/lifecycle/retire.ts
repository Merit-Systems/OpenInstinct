import { z } from "zod";
import { deleteBrowserSession } from "@db/services/browsers";
import type { AccessScope } from "@shared/identity/access-scope";
import { kernel } from "../kernel";
import { disposeBrowserLoopSession } from "../semantic-loop";
import { harvestBrowserTraceDomains } from "../trace/domains";

const auxiliaryBudgetMs = 3_000;
const releaseBudgetMs = 20_000;

/** Forget ownership only after Kernel confirms release or absence. */
export async function retireBrowserSession(
  scope: AccessScope,
  workerSessionId: string,
  browser: Parameters<typeof harvestBrowserTraceDomains>[2],
  signal?: AbortSignal
) {
  await retirementHousekeeping(
    "telemetry",
    (stepSignal) =>
      harvestBrowserTraceDomains(scope, workerSessionId, browser, stepSignal),
    signal
  );
  await retirementHousekeeping(
    "reference cleanup",
    () => disposeBrowserLoopSession(browser.sessionId),
    signal
  );
  // Optional housekeeping cannot consume the provider's release deadline.
  const deadline = AbortSignal.timeout(releaseBudgetMs);
  const releaseSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    await kernel.browsers.deleteByID(browser.sessionId, {
      signal: releaseSignal,
    });
  } catch (error) {
    if (!z.object({ status: z.literal(404) }).safeParse(error).success)
      throw error;
  }
  await deleteBrowserSession(scope, browser.sessionId);
}

async function retirementHousekeeping(
  step: "telemetry" | "reference cleanup",
  operation: (signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal
) {
  const deadline = AbortSignal.timeout(auxiliaryBudgetMs);
  const stepSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(stepSignal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Retirement housekeeping timed out."));
        }, auxiliaryBudgetMs);
      }),
    ]);
  } catch {
    // A cache or telemetry failure must not keep the hosted browser running.
    console.warn("[browser-lifecycle] Optional retirement step failed", {
      step,
    });
  } finally {
    clearTimeout(timer);
  }
}
