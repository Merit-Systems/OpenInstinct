import Kernel from "@onkernel/sdk";
import type {
  BrowserCreateResponse,
  BrowserRetrieveResponse,
  BrowserUpdateResponse,
} from "@onkernel/sdk/resources/browsers";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import {
  createBrowserSession,
  deleteBrowserSession,
  listBrowserSessions,
  readBrowserSession,
} from "@/db/services/browsers";
import type { AccessScope } from "@/lib/access-scope";
import type {
  computerActionInputSchema,
  executePlaywrightInputSchema,
  manageBrowsersInputSchema,
} from "./browser-contract";
import { browserTimeoutFloorSeconds } from "./browser-contract";
import { env } from "@/lib/env";

type ManageBrowsersInput = z.infer<typeof manageBrowsersInputSchema>;
type ComputerActionInput = z.infer<typeof computerActionInputSchema>;

export async function manageOwnedKernelBrowsers(
  scope: AccessScope,
  input: ManageBrowsersInput,
  signal?: AbortSignal
) {
  const client = new Kernel({ apiKey: env.KERNEL_API_KEY });

  switch (input.action) {
    case "create": {
      const extensionArchive = await findPackagedVaultAutofillExtension();
      const extensionName = env.KERNEL_VAULT_AUTOFILL_EXTENSION;
      const storedExtension =
        extensionArchive === undefined
          ? await client.extensions.get(extensionName, { signal })
          : undefined;
      const browser = await client.browsers.create(
        {
          extensions:
            extensionArchive === undefined
              ? [{ id: storedExtension?.id }]
              : undefined,
          start_url:
            extensionArchive === undefined ? input.start_url : undefined,
          stealth: true,
          timeout_seconds: input.timeout_seconds ?? browserTimeoutFloorSeconds,
          viewport: browserViewport(input),
        },
        { signal }
      );
      try {
        if (extensionArchive !== undefined) {
          await loadPackagedVaultAutofillExtension(
            client,
            browser.session_id,
            extensionArchive,
            extensionName,
            signal
          );
          if (input.start_url) {
            await client.browsers.playwright.execute(
              browser.session_id,
              {
                code: navigateToStartUrlCode(input.start_url),
                timeout_sec: 30,
              },
              { signal }
            );
          }
        }
        await createBrowserSession(scope, {
          createdAt: browser.created_at,
          sessionId: browser.session_id,
        });
      } catch (error) {
        await client.browsers
          .deleteByID(browser.session_id, { signal })
          .catch(() => undefined);
        throw error;
      }
      return lifecycleResult(browser);
    }
    case "list": {
      const records = await listBrowserSessions(scope);
      const includeDeleted = input.status !== "active";
      const browsers = await Promise.all(
        records.map(async ({ sessionId }) => {
          try {
            const browser = await client.browsers.retrieve(
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
          } catch {
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
        await client.browsers.retrieve(sessionId, {}, { signal })
      );
    }
    case "update": {
      const sessionId = requireSessionId(input.session_id);
      await requireOwnedBrowserSession(scope, sessionId);
      const viewport = browserViewport(input);
      const browser = viewport
        ? await client.browsers.update(sessionId, { viewport }, { signal })
        : await client.browsers.retrieve(sessionId, {}, { signal });
      return lifecycleResult(browser);
    }
    case "delete": {
      const sessionId = requireSessionId(input.session_id);
      await requireOwnedBrowserSession(scope, sessionId);
      await client.browsers.deleteByID(sessionId, { signal });
      await deleteBrowserSession(scope, sessionId);
      return "Browser session deleted successfully";
    }
  }
}

async function loadPackagedVaultAutofillExtension(
  client: Kernel,
  sessionId: string,
  archive: string,
  extensionName: string,
  signal?: AbortSignal
) {
  const form = new FormData();
  form.append("extensions[0].name", extensionName);
  form.append(
    "extensions[0].zip_file",
    new File([await readFile(archive)], `${extensionName}.zip`, {
      type: "application/zip",
    })
  );

  // Kernel's live API expects bracket-dot multipart keys. SDK 0.96 emits
  // bracket-bracket keys here, which the API rejects as invalid fields.
  await client.post<unknown>(
    `/browsers/${encodeURIComponent(sessionId)}/extensions`,
    {
      body: form,
      headers: { Accept: "*/*" },
      signal,
    }
  );
}

async function findPackagedVaultAutofillExtension() {
  const outputDirectory = join(process.cwd(), ".output");
  let archives: string[];
  try {
    archives = (await readdir(outputDirectory)).filter((name) =>
      name.endsWith("-chrome.zip")
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (archives.length === 0) return undefined;
  if (archives.length > 1) {
    throw new Error(
      `Expected one packaged vault autofill extension, found ${String(archives.length)}.`
    );
  }
  const archive = archives[0];
  return archive ? join(outputDirectory, archive) : undefined;
}

function navigateToStartUrlCode(startUrl: string) {
  return `
const page = context.pages().at(-1) ?? await context.newPage();
await page.goto(${JSON.stringify(startUrl)}, { waitUntil: "domcontentloaded" });
`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function executeOwnedKernelPlaywright(
  scope: AccessScope,
  input: z.infer<typeof executePlaywrightInputSchema>,
  signal?: AbortSignal
) {
  await requireOwnedBrowserSession(scope, input.session_id);
  return new Kernel({ apiKey: env.KERNEL_API_KEY }).browsers.playwright.execute(
    input.session_id,
    { code: input.code, timeout_sec: 30 },
    { signal }
  );
}

export async function executeOwnedKernelComputerAction(
  scope: AccessScope,
  input: ComputerActionInput,
  signal?: AbortSignal
) {
  await requireOwnedBrowserSession(scope, input.session_id);
  const client = new Kernel({ apiKey: env.KERNEL_API_KEY });
  const computer = client.browsers.computer;
  const data: unknown[] = [];
  let screenshotBase64: string | undefined;

  for (const action of input.actions) {
    switch (action.type) {
      case "click_mouse":
        await computer.clickMouse(
          input.session_id,
          requiredAction(action.click_mouse, action.type),
          { signal }
        );
        break;
      case "move_mouse":
        await computer.moveMouse(
          input.session_id,
          requiredAction(action.move_mouse, action.type),
          { signal }
        );
        break;
      case "type_text":
        await computer.typeText(
          input.session_id,
          requiredAction(action.type_text, action.type),
          { signal }
        );
        break;
      case "press_key":
        await computer.pressKey(
          input.session_id,
          requiredAction(action.press_key, action.type),
          { signal }
        );
        break;
      case "scroll":
        await computer.scroll(
          input.session_id,
          requiredAction(action.scroll, action.type),
          { signal }
        );
        break;
      case "drag_mouse":
        await computer.dragMouse(
          input.session_id,
          requiredAction(action.drag_mouse, action.type),
          { signal }
        );
        break;
      case "set_cursor":
        data.push(
          await computer.setCursorVisibility(
            input.session_id,
            requiredAction(action.set_cursor, action.type),
            { signal }
          )
        );
        break;
      case "sleep":
        await computer.batch(
          input.session_id,
          {
            actions: [
              {
                sleep: requiredAction(action.sleep, action.type),
                type: "sleep",
              },
            ],
          },
          { signal }
        );
        break;
      case "write_clipboard":
        await computer.writeClipboard(
          input.session_id,
          requiredAction(action.write_clipboard, action.type),
          { signal }
        );
        break;
      case "read_clipboard":
        data.push(await computer.readClipboard(input.session_id, { signal }));
        break;
      case "get_mouse_position":
        data.push(
          await computer.getMousePosition(input.session_id, { signal })
        );
        break;
      case "screenshot": {
        const removeMask = await maskVaultFields(
          client,
          input.session_id,
          signal
        );
        try {
          const response = await computer.captureScreenshot(
            input.session_id,
            action.screenshot,
            { signal }
          );
          screenshotBase64 = Buffer.from(await response.arrayBuffer()).toString(
            "base64"
          );
        } finally {
          await removeMask();
        }
        break;
      }
    }
  }

  return {
    data: data.length > 0 ? data : undefined,
    message: `Executed ${String(input.actions.length)} computer action${input.actions.length === 1 ? "" : "s"}.`,
    mimeType: screenshotBase64 ? ("image/png" as const) : undefined,
    screenshotBase64,
  };
}

export async function requireOwnedBrowserSession(
  scope: AccessScope,
  sessionId: string
) {
  const record = await readBrowserSession(scope, sessionId);
  if (!record) throw new Error("Browser session not found.");
  return record;
}

function requireSessionId(sessionId: string | undefined) {
  if (!sessionId) throw new Error("A browser session ID is required.");
  return sessionId;
}

function requiredAction<T>(value: T | undefined, action: string): T {
  if (value === undefined) {
    throw new Error(`Computer action ${action} is missing its payload.`);
  }
  return value;
}

function browserViewport(input: ManageBrowsersInput) {
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
    session_id: browser.session_id,
    status: browser.deleted_at ? "deleted" : "active",
    stealth: browser.stealth,
    viewport: browser.viewport ?? undefined,
  };
}

function lifecycleResult(browser: KernelBrowser) {
  const value = browserDescriptor(browser);
  return {
    browser: value,
    next_actions: [
      `Use execute_playwright_code with session_id "${value.session_id}" for deterministic browser automation.`,
      `Use computer_action with session_id "${value.session_id}" for visual browser control.`,
      value.stealth
        ? "Kernel's managed CAPTCHA solver is active. Leave challenges untouched and wait for them to clear."
        : "This browser does not have Kernel's managed CAPTCHA solver active.",
      `Use manage_browsers with action "delete" and session_id "${value.session_id}" when finished.`,
    ],
  };
}

async function maskVaultFields(
  client: Kernel,
  sessionId: string,
  signal?: AbortSignal
) {
  const styleId = "vault-screenshot-mask";
  const selector = '[data-vault-secret="true"]';
  const addCode = `
for (const currentContext of browser.contexts()) {
  for (const currentPage of currentContext.pages()) {
    for (const frame of currentPage.frames()) {
      await frame.evaluate(({ styleId, selector }) => {
        if (document.getElementById(styleId)) return;
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = selector + " { color: transparent !important; text-shadow: 0 0 8px black !important; -webkit-text-security: disc !important; }";
        document.documentElement.append(style);
      }, ${JSON.stringify({ selector, styleId })}).catch(() => undefined);
    }
  }
}
return true;`;
  await client.browsers.playwright.execute(
    sessionId,
    { code: addCode, timeout_sec: 10 },
    { signal }
  );
  return async () => {
    const removeCode = `
for (const currentContext of browser.contexts()) {
  for (const currentPage of currentContext.pages()) {
    for (const frame of currentPage.frames()) {
      await frame.evaluate((styleId) => document.getElementById(styleId)?.remove(), ${JSON.stringify(styleId)}).catch(() => undefined);
    }
  }
}
return true;`;
    await client.browsers.playwright
      .execute(sessionId, { code: removeCode, timeout_sec: 10 }, { signal })
      .catch(() => undefined);
  };
}
