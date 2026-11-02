import { randomUUID } from "node:crypto";
import { NotFoundError } from "@onkernel/sdk";

// oxlint-disable-next-line eslint/no-restricted-properties, turbo/no-undeclared-env-vars -- A standalone provider check requires explicit opt-in before loading credentials.
if (process.env.OPENINSTINCT_LIVE_BROWSER_CHECK !== "1") {
  console.log(
    "Skipped live browser check. Set OPENINSTINCT_LIVE_BROWSER_CHECK=1 to use real Kernel resources."
  );
  process.exit(0);
}

const { kernel } = await import("../agent/subagents/browser-agent/lib/kernel");
const profileName = `openinstinct-check-${randomUUID()}`;
const browsers = new Set<string>();
const failures: unknown[] = [];
const options = () => ({ signal: AbortSignal.timeout(30_000), maxRetries: 0 });
const cookie = {
  name: "openinstinct_lifecycle_check",
  value: randomUUID(),
  url: "https://browser-check.invalid",
};
let profileId: string | undefined;

async function release(sessionId: string) {
  try {
    await kernel.browsers.deleteByID(sessionId, options());
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  try {
    const state = await kernel.browsers.retrieve(
      sessionId,
      { include_deleted: true },
      options()
    );
    if (!state.deleted_at)
      throw new Error("Kernel still reports the retired browser as active.");
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  browsers.delete(sessionId);
}

try {
  const profile = await kernel.profiles.create(
    { name: profileName },
    options()
  );
  if (!profile.id) throw new Error("Kernel returned no profile ID.");
  profileId = profile.id;
  const writer = await kernel.browsers.create(
    {
      profile: { id: profile.id, save_changes: true },
      timeout_seconds: 120,
      telemetry: { enabled: false },
    },
    options()
  );
  browsers.add(writer.session_id);
  const written = await kernel.browsers.playwright.execute(
    writer.session_id,
    {
      code: `if (!context) throw new Error('No browser context'); await context.addCookies([${JSON.stringify(cookie)}]); return true;`,
      timeout_sec: 20,
    },
    options()
  );
  if (!written.success)
    throw new Error(
      `Synthetic profile cookie could not be written: ${written.error ?? "unknown provider error"}`
    );
  await release(writer.session_id);

  const reader = await kernel.browsers.create(
    {
      profile: { id: profile.id, save_changes: false },
      timeout_seconds: 120,
      telemetry: { enabled: false },
    },
    options()
  );
  browsers.add(reader.session_id);
  const restored = await kernel.browsers.playwright.execute(
    reader.session_id,
    {
      code: `if (!context) throw new Error('No browser context'); const restoredCookies = await context.cookies(${JSON.stringify(cookie.url)}); return restoredCookies.some(cookie => cookie.name === ${JSON.stringify(cookie.name)} && cookie.value === ${JSON.stringify(cookie.value)});`,
      timeout_sec: 20,
    },
    options()
  );
  if (!restored.success || restored.result !== true)
    throw new Error(
      `The reader did not restore the synthetic profile cookie: ${restored.error ?? "cookie missing"}`
    );
  await release(reader.session_id);
  console.log(
    "Passed: profile persisted across writer retirement and a fresh read-only browser; both browsers retired."
  );
} catch (error) {
  failures.push(error);
} finally {
  // A create request can succeed remotely before its response is lost. Recover
  // only browsers attached to this check's uniquely named temporary profile.
  if (profileId) {
    try {
      for await (const browser of kernel.browsers.list(
        { query: profileId, status: "active" },
        options()
      )) {
        if (browser.profile?.id === profileId) browsers.add(browser.session_id);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  const cleanup = await Promise.allSettled([...browsers].map(release));
  for (const result of cleanup) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  // Keep the profile when browser release failed, so the provider resources can
  // still be located by their unique profile name.
  if (browsers.size === 0) {
    try {
      await kernel.profiles.delete(profileId ?? profileName, options());
    } catch (error) {
      if (!(error instanceof NotFoundError)) failures.push(error);
    }
  }
}
if (failures.length > 0) {
  console.error(`Live check failed; temporary profile: ${profileName}`);
  throw new AggregateError(
    failures,
    "Kernel lifecycle check or cleanup failed."
  );
}
console.log(
  "Cleanup verified: the temporary profile and browsers were released."
);
