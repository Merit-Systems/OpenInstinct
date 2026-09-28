import { env } from "@shared/environment";
import { BrowserExecutor } from "@onkernel/browser-loop";
import {
  ensureNotteProfile,
  isNotteSession,
  notteCdpUrl,
  retrieveNotteBrowser,
  startNotteBrowser,
  stopNotteBrowser,
} from "../lib/notte";
import { createHash } from "node:crypto";
import { ConflictError, NotFoundError } from "@onkernel/sdk";
import type {
  BrowserCreateResponse,
  BrowserRetrieveResponse,
  BrowserUpdateResponse,
} from "@onkernel/sdk/resources/browsers";
import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  createBrowserSession,
  deleteBrowserSession,
  listBrowserSessions,
  withBrowserProfileWriteLock,
} from "@db/services/browsers";
import { recordBrowserTraceDomains } from "@db/services/browser-traces";
import { kernel } from "@agent/subagents/browser-agent/lib/kernel";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { disposeBrowserLoopSession } from "../lib/semantic-loop";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import {
  domainFromUrl,
  harvestBrowserTraceDomains,
} from "@agent/subagents/browser-agent/lib/trace/domains";

const browserTimeoutFloorSeconds = 15 * 60;

const inputSchema = z.object({
  action: z.enum(["create", "update", "list", "get", "delete"]),
  save_changes: z.boolean().optional(),
  session_id: z.string().optional(),
  start_url: z.url().optional(),
  timeout_seconds: z
    .number()
    .int()
    .min(browserTimeoutFloorSeconds)
    .max(259_200)
    .optional(),
  viewport_width: z.number().int().min(1).optional(),
  viewport_height: z.number().int().min(1).optional(),
  status: z.enum(["active", "deleted", "all"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const manageBrowsers = defineTool({
  description:
    'Manage browser sessions backed by the workspace persistent profile. Create read-only browsers by default so tasks can run in parallel. Immediately before a login, replace that task browser with one created using save_changes: true, then delete it after authentication so the session is saved. Only one profile writer may be active. Use "list" or "get" to inspect sessions.',
  inputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    const signal = context.abortSignal;
    if (env.BROWSER_PROVIDER === "notte") {
      return manageNotteBrowsers(input, context, scope);
    }
    if (input.session_id && isNotteSession(input.session_id)) {
      throw new Error(
        "This session belongs to Notte. Restore BROWSER_PROVIDER=notte to manage it."
      );
    }

    switch (input.action) {
      case "create": {
        const create = async () => {
          const profile = await ensureWorkspaceProfile(
            scope.workspaceId,
            signal
          );
          if (input.save_changes) {
            const activeWriter = await findActiveProfileWriter(
              profile.id,
              signal
            );
            if (activeWriter) {
              throw new Error(
                `Browser session ${activeWriter.session_id} is already saving login state for this workspace. Retry after it finishes.`
              );
            }
          }
          const browser = await kernel.browsers.create(
            {
              profile: {
                id: profile.id,
                save_changes: input.save_changes ?? false,
              },
              start_url: input.start_url,
              stealth: true,
              telemetry: {
                browser: { page: { enabled: true } },
                enabled: true,
              },
              timeout_seconds:
                input.timeout_seconds ?? browserTimeoutFloorSeconds,
              viewport: browserViewport(input),
            },
            { maxRetries: 8, signal }
          );
          try {
            await createBrowserSession(scope, {
              createdAt: browser.created_at,
              sessionId: browser.session_id,
              workerSessionId: context.session.id,
            });
          } catch (error) {
            await kernel.browsers
              .deleteByID(browser.session_id, { signal })
              .catch(() => undefined);
            throw error;
          }
          const startDomain = input.start_url
            ? domainFromUrl(input.start_url)
            : undefined;
          if (startDomain) {
            await recordBrowserTraceDomains(scope, context.session.id, [
              startDomain,
            ]).catch(() => undefined);
          }
          return lifecycleResult(browser);
        };
        return input.save_changes
          ? withBrowserProfileWriteLock(scope, create)
          : create();
      }
      case "list": {
        const records = (await listBrowserSessions(scope)).filter(
          ({ sessionId }) => !isNotteSession(sessionId)
        );
        const includeDeleted = input.status !== "active";
        const browsers = await Promise.all(
          records.map(async ({ sessionId }) => {
            try {
              const browser = await kernel.browsers.retrieve(
                sessionId,
                { include_deleted: includeDeleted },
                { signal }
              );
              const value = browserDescriptor(browser);
              if (input.status === "deleted" && value.status !== "deleted") {
                return null;
              }
              if (input.status === "active" && value.status !== "active") {
                return null;
              }
              return value;
            } catch (error) {
              if (isNotFoundError(error)) {
                await deleteBrowserSession(scope, sessionId);
              }
              return null;
            }
          })
        );
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 100;
        return {
          has_more: false,
          items: browsers
            .filter((browser) => browser !== null)
            .slice(offset, offset + limit),
          next_offset: null,
        };
      }
      case "get": {
        const sessionId = requireSessionId(input.session_id);
        await requireOwnedBrowserSession(scope, sessionId);
        return browserDescriptor(
          await retrieveBrowser(scope, sessionId, signal)
        );
      }
      case "update": {
        const sessionId = requireSessionId(input.session_id);
        await requireOwnedBrowserSession(scope, sessionId);
        const viewport = browserViewport(input);
        const browser = viewport
          ? await kernel.browsers.update(sessionId, { viewport }, { signal })
          : await retrieveBrowser(scope, sessionId, signal);
        return lifecycleResult(browser);
      }
      case "delete": {
        const sessionId = requireSessionId(input.session_id);
        const record = await requireOwnedBrowserSession(scope, sessionId);
        await harvestBrowserTraceDomains(
          scope,
          record.workerSessionId ?? context.session.id,
          { createdAt: record.createdAt, sessionId: record.sessionId },
          signal
        );
        await disposeBrowserLoopSession(sessionId);
        await kernel.browsers
          .deleteByID(sessionId, { signal })
          .catch((cause: unknown) => {
            if (!isNotFoundError(cause)) throw cause;
          });
        await deleteBrowserSession(scope, sessionId);
        return "Browser session deleted successfully";
      }
    }
    throw new Error("Unsupported browser management action.");
  },
});

export default manageBrowsers;

function requireSessionId(sessionId: string | undefined) {
  if (!sessionId) throw new Error("A browser session ID is required.");
  return sessionId;
}

async function retrieveBrowser(
  scope: Awaited<ReturnType<typeof requireWorkerScope>>,
  sessionId: string,
  signal?: AbortSignal
) {
  try {
    return await kernel.browsers.retrieve(sessionId, {}, { signal });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await disposeBrowserLoopSession(sessionId);
    await deleteBrowserSession(scope, sessionId);
    throw new Error(
      "Browser session no longer exists. Its stale record was removed; create a fresh browser instead of retrying this session ID.",
      { cause: error }
    );
  }
}

function isNotFoundError(cause: unknown) {
  return z.object({ status: z.literal(404) }).safeParse(cause).success;
}

function browserViewport(input: z.infer<typeof inputSchema>) {
  const height = input.viewport_height;
  const width = input.viewport_width;
  if (height === undefined && width === undefined) return undefined;
  if (height === undefined || width === undefined) {
    throw new Error("Viewport width and height must be provided together.");
  }
  return { height, width };
}

type KernelBrowser =
  | BrowserCreateResponse
  | BrowserRetrieveResponse
  | BrowserUpdateResponse;

function browserDescriptor(browser: KernelBrowser) {
  return {
    browser_live_view_url: browser.browser_live_view_url,
    session_id: browser.session_id,
    status: browser.deleted_at ? "deleted" : "active",
    viewport: browser.viewport ?? undefined,
  };
}

function lifecycleResult(browser: KernelBrowser) {
  const value = browserDescriptor(browser);
  return {
    browser: value,
    next_actions: [
      `Use playwright_execute with session_id "${value.session_id}" as the primary surface for deterministic inspection and interaction, including related safe actions, extraction, JavaScript, loops, and pagination.`,
      `If Playwright is unreliable or semantic interaction is more suitable, call browser_snapshot with session_id "${value.session_id}" to mint current refs; use browser_find or browser_text to narrow large pages.`,
      `Then use browser_act with session_id "${value.session_id}" as a relaxed fallback for short ref-based click, fill, and submit plans; inspect its successor state instead of waiting on per-action postconditions.`,
      `Use computer_action with session_id "${value.session_id}" only when visual reasoning or coordinate control is necessary.`,
      `Use manage_browsers with action "delete" and session_id "${value.session_id}" when finished.`,
    ],
  };
}

export function kernelProfileNameForWorkspace(workspaceId: string) {
  return `openinstinct-${createHash("sha256")
    .update(`kernel-profile\0${workspaceId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

async function ensureWorkspaceProfile(
  workspaceId: string,
  signal?: AbortSignal
) {
  const name = kernelProfileNameForWorkspace(workspaceId);
  try {
    return await kernel.profiles.retrieve(name, { signal });
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  try {
    return await kernel.profiles.create({ name }, { signal });
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    return kernel.profiles.retrieve(name, { signal });
  }
}

async function findActiveProfileWriter(
  profileId: string | undefined,
  signal: AbortSignal | undefined
) {
  if (!profileId) return undefined;
  for await (const browser of kernel.browsers.list(
    { query: profileId, status: "active" },
    { signal }
  )) {
    if (browser.profile?.id === profileId && browser.profile_save_changes) {
      return browser;
    }
  }
  return undefined;
}

async function manageNotteBrowsers(
  input: z.infer<typeof inputSchema>,
  context: Parameters<typeof requireWorkerScope>[0] & {
    abortSignal?: AbortSignal;
  },
  scope: Awaited<ReturnType<typeof requireWorkerScope>>
) {
  const signal = context.abortSignal;
  if (input.action === "create") {
    const viewport = browserViewport(input);
    // Serialize profile lookup/creation and writer checks across app instances.
    return withBrowserProfileWriteLock(scope, async () => {
      const records = (await listBrowserSessions(scope)).filter(
        ({ sessionId }) => sessionId.startsWith("notte:write:")
      );
      if (input.save_changes) {
        const writers = await Promise.all(
          records.map(async ({ sessionId }) => {
            try {
              return await retrieveNotteBrowser(sessionId, signal);
            } catch (error) {
              if (!isNotFoundError(error)) throw error;
              return undefined;
            }
          })
        );
        if (writers.some((browser) => browser?.status === "active")) {
          throw new Error(
            "Another Notte browser is saving this workspace profile. Delete it before creating a writer."
          );
        }
      }
      const browser = await startNotteBrowser(
        {
          profileId: await ensureNotteProfile(scope.workspaceId, signal),
          writable: input.save_changes ?? false,
          timeoutSeconds: input.timeout_seconds ?? browserTimeoutFloorSeconds,
          viewport,
        },
        signal
      );
      try {
        if (input.start_url) {
          const executor = new BrowserExecutor(
            await notteCdpUrl(browser.session_id, signal)
          );
          try {
            await executor.execute(
              { type: "browser_navigate", url: input.start_url },
              signal
            );
          } finally {
            executor.close();
          }
        }
        await createBrowserSession(scope, {
          createdAt: browser.created_at,
          sessionId: browser.session_id,
          workerSessionId: context.session.id,
        });
      } catch (error) {
        // Cleanup must still run when the originating turn has been cancelled.
        await stopNotteBrowser(browser.session_id).catch(() => undefined);
        throw error;
      }
      const domain = input.start_url
        ? domainFromUrl(input.start_url)
        : undefined;
      if (domain)
        await recordBrowserTraceDomains(scope, context.session.id, [
          domain,
        ]).catch(() => undefined);
      return {
        browser: describeNotteBrowser(browser),
        next_actions: [
          "Use browser_snapshot, browser_find, browser_text, browser_act and browser_wait_for to inspect and control this Notte browser over CDP.",
          "Use fill_from_vault for secure autofill. Create with save_changes: true before login and delete the writer to persist it.",
          "Remote playwright_execute, computer_action and capture_browser_image are unavailable with Notte. Use the live-view URL for human takeover when needed.",
          "Delete this browser with manage_browsers when finished.",
        ],
      };
    });
  }
  if (input.action === "list") {
    const records = (await listBrowserSessions(scope)).filter(({ sessionId }) =>
      isNotteSession(sessionId)
    );
    const browsers = await Promise.all(
      records.map(async ({ sessionId }) => {
        try {
          return describeNotteBrowser(
            await retrieveNotteBrowser(sessionId, signal)
          );
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          await deleteBrowserSession(scope, sessionId);
          return undefined;
        }
      })
    );
    const filtered = browsers.filter(
      (browser) =>
        browser &&
        (!input.status ||
          input.status === "all" ||
          browser.status === input.status)
    );
    const offset = input.offset ?? 0;
    const end = offset + (input.limit ?? 100);
    return {
      items: filtered.slice(offset, end),
      has_more: filtered.length > end,
      next_offset: filtered.length > end ? end : null,
    };
  }
  const id = requireSessionId(input.session_id);
  await requireOwnedBrowserSession(scope, id);
  if (!isNotteSession(id))
    throw new Error(
      "This session belongs to Kernel. Restore BROWSER_PROVIDER=kernel to manage it."
    );
  if (input.action === "delete") {
    await disposeBrowserLoopSession(id);
    try {
      await stopNotteBrowser(id, signal);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    await deleteBrowserSession(scope, id);
    return "Browser session deleted successfully";
  }
  if (input.action === "update" && browserViewport(input)) {
    throw new Error(
      "Set the Notte viewport when creating the browser; resizing an existing session is not supported."
    );
  }
  try {
    return describeNotteBrowser(await retrieveNotteBrowser(id, signal));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await disposeBrowserLoopSession(id);
    await deleteBrowserSession(scope, id);
    throw new Error("Notte browser no longer exists. Create a fresh browser.", {
      cause: error,
    });
  }
}

function describeNotteBrowser(
  browser: Awaited<ReturnType<typeof retrieveNotteBrowser>>
) {
  return {
    session_id: browser.session_id,
    status: browser.status,
    browser_live_view_url: browser.browser_live_view_url,
    viewport: browser.viewport,
  };
}
