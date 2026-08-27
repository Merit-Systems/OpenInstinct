import Kernel from "@onkernel/sdk";
import type {
  BrowserCreateResponse,
  BrowserRetrieveResponse,
  BrowserUpdateResponse,
} from "@onkernel/sdk/resources/browsers";
import type { z } from "zod";
import type { AccessScope } from "../access-scope";
import type {
  computerActionInputSchema,
  executePlaywrightInputSchema,
  manageBrowsersInputSchema,
} from "../kernel-browser-contract";
import { getEnv } from "../runtime-env";
import { getAppStore } from "./app-store";

type ManageBrowsersInput = z.infer<typeof manageBrowsersInputSchema>;
type ComputerActionInput = z.infer<typeof computerActionInputSchema>;

export async function manageOwnedKernelBrowsers(
  scope: AccessScope,
  input: ManageBrowsersInput,
  signal?: AbortSignal
) {
  const client = kernelClient();
  const store = await getAppStore();

  switch (input.action) {
    case "create": {
      const extensionName = getEnv().KERNEL_VAULT_AUTOFILL_EXTENSION;
      const browser = await client.browsers.create(
        {
          extensions: extensionName ? [{ name: extensionName }] : undefined,
          start_url: input.start_url,
          stealth: true,
          timeout_seconds: input.timeout_seconds ?? 900,
          viewport: browserViewport(input),
        },
        { signal }
      );
      try {
        await store.createBrowserSession(scope, {
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
      const records = await store.listBrowserSessions(scope);
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
      await store.deleteBrowserSession(scope, sessionId);
      return "Browser session deleted successfully";
    }
  }
}

export async function executeOwnedKernelPlaywright(
  scope: AccessScope,
  input: z.infer<typeof executePlaywrightInputSchema>,
  signal?: AbortSignal
) {
  await requireOwnedBrowserSession(scope, input.session_id);
  return kernelClient().browsers.playwright.execute(
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
  const client = kernelClient();
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
  const record = await (
    await getAppStore()
  ).readBrowserSession(scope, sessionId);
  if (!record) throw new Error("Browser session not found.");
  return record;
}

function kernelClient() {
  const apiKey = getEnv().KERNEL_API_KEY;
  if (!apiKey) throw new Error("The browser runtime is unavailable.");
  return new Kernel({ apiKey });
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
