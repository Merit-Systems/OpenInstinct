import { existsSync, mkdirSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { z } from "zod";
import {
  computerActionInputSchema,
  executePlaywrightInputSchema,
  manageBrowsersInputSchema,
} from "../lib/kernel-browser-contract.ts";
import {
  localBrowserActionSchema,
  localVaultAutofillSchema,
} from "../lib/local-browser.ts";
import { getEnv } from "../lib/runtime-env.ts";

const browserPort = 4275;
const localSessionId = "local-browser";
const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;
type ComputerAction = z.infer<
  typeof computerActionInputSchema
>["actions"][number];
type BrowserRuntimeRequest =
  | NonNullable<ComputerAction["screenshot"]>
  | NonNullable<ComputerAction["write_clipboard"]>
  | { readonly actions: readonly ComputerAction[] }
  | { readonly code: string; readonly timeout_sec: number };
const env = getEnv();
const browserVisible = env.LOCAL_VAULT_ASSISTANT_BROWSER_VISIBLE;
const kernelImageApiUrl = env.LOCAL_VAULT_ASSISTANT_KERNEL_IMAGE_API_URL;
const kernelImageCdpUrl = env.LOCAL_VAULT_ASSISTANT_KERNEL_IMAGE_CDP_URL;
const profileDirectory = join(
  env.LOCAL_VAULT_ASSISTANT_DATA_DIR ??
    join(homedir(), ".local-vault-assistant"),
  "browser-profile"
);
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let sessionDeleted = false;
let mousePosition = { x: 0, y: 0 };
let clipboardText = "";

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse
) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  if (
    request.method !== "POST" ||
    ![
      "/action",
      "/vault-fill",
      "/kernel/computer_action",
      "/kernel/execute_playwright_code",
      "/kernel/manage_browsers",
    ].includes(request.url ?? "") ||
    request.socket.remoteAddress !== "127.0.0.1"
  ) {
    response.writeHead(404).end(JSON.stringify({ error: "Not found." }));
    return;
  }

  try {
    const body = jsonValueSchema.parse(
      JSON.parse(await readRequestBody(request))
    );
    const result = await executeRequest(request.url, body);
    response.writeHead(200).end(JSON.stringify({ result }));
  } catch (error) {
    response.writeHead(400).end(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "The browser action failed.",
      })
    );
  }
}

async function executeRequest(url: string | undefined, body: JsonValue) {
  switch (url) {
    case "/vault-fill":
      return executeVaultAutofill(localVaultAutofillSchema.parse(body));
    case "/kernel/computer_action":
      return executeComputerActions(computerActionInputSchema.parse(body));
    case "/kernel/execute_playwright_code":
      return executePlaywrightCode(executePlaywrightInputSchema.parse(body));
    case "/kernel/manage_browsers":
      return manageBrowsers(manageBrowsersInputSchema.parse(body));
    default:
      return execute(localBrowserActionSchema.parse(body));
  }
}

server.listen(browserPort, "127.0.0.1", () => {
  console.log(`Local browser input: http://127.0.0.1:${String(browserPort)}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown();
  });
}

async function execute(action: z.infer<typeof localBrowserActionSchema>) {
  if (action.action === "close") {
    await context?.close();
    context = undefined;
    page = undefined;
    return { closed: true };
  }

  const activePage = await getPage();
  switch (action.action) {
    case "back":
      await activePage.goBack({ waitUntil: "domcontentloaded" });
      return inspect(activePage);
    case "click":
      await referencedElement(activePage, action.ref).click();
      await settle(activePage);
      return inspect(activePage);
    case "fill": {
      const element = referencedElement(activePage, action.ref);
      const type = await element.getAttribute("type");
      if (type?.toLowerCase() === "password") {
        throw new Error(
          "Password fields require the trusted local vault injection flow."
        );
      }
      await element.fill(action.text);
      return inspect(activePage);
    }
    case "inspect":
      return inspect(activePage);
    case "open":
      await activePage.goto(action.url, {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      return inspect(activePage);
    case "press":
      if (action.ref) {
        await referencedElement(activePage, action.ref).press(action.key);
      } else {
        await activePage.keyboard.press(action.key);
      }
      await settle(activePage);
      return inspect(activePage);
    case "scroll":
      await activePage.evaluate(({ direction, pixels }) => {
        window.scrollBy({
          behavior: "auto",
          top: direction === "down" ? pixels : -pixels,
        });
      }, action);
      return inspect(activePage);
  }
}

async function manageBrowsers(
  input: z.infer<typeof manageBrowsersInputSchema>
) {
  switch (input.action) {
    case "create": {
      const activePage = await getPage();
      sessionDeleted = false;
      if (input.start_url) {
        await activePage.goto(input.start_url, {
          timeout: 30_000,
          waitUntil: "domcontentloaded",
        });
      }
      if (input.viewport_width && input.viewport_height) {
        await activePage.setViewportSize({
          height: input.viewport_height,
          width: input.viewport_width,
        });
      }
      return {
        browser: browserDescriptor(),
        next_actions: browserNextActions(),
      };
    }
    case "list":
      return {
        has_more: false,
        items: sessionDeleted ? [] : [browserDescriptor()],
        next_offset: null,
      };
    case "get":
      requireLocalSession(input.session_id);
      return browserDescriptor();
    case "update": {
      requireLocalSession(input.session_id);
      if (
        (input.viewport_width === undefined) !==
        (input.viewport_height === undefined)
      ) {
        throw new Error(
          "viewport_width and viewport_height must be provided together."
        );
      }
      if (input.viewport_width && input.viewport_height) {
        await (
          await getPage()
        ).setViewportSize({
          height: input.viewport_height,
          width: input.viewport_width,
        });
      }
      return {
        browser: browserDescriptor(),
        next_actions: browserNextActions(),
      };
    }
    case "delete":
      requireLocalSession(input.session_id);
      await closeBrowserSession();
      sessionDeleted = true;
      return "Browser session deleted successfully";
  }
}

async function executePlaywrightCode(
  input: z.infer<typeof executePlaywrightInputSchema>
) {
  requireLocalSession(input.session_id);
  if (!kernelImageApiUrl) {
    throw new Error(
      "Playwright execution is temporarily unavailable. Use computer_action or restart the browser runtime after setup completes."
    );
  }
  return kernelImageJson("/playwright/execute", {
    code: input.code,
    timeout_sec: 60,
  });
}

async function executeComputerActions(
  input: z.infer<typeof computerActionInputSchema>
) {
  requireLocalSession(input.session_id);
  await getPage();
  const terminalTypes = new Set([
    "get_mouse_position",
    "read_clipboard",
    "screenshot",
  ]);
  const invalidTerminal = input.actions
    .slice(0, -1)
    .find(({ type }) => terminalTypes.has(type));
  if (invalidTerminal) {
    throw new Error(`${invalidTerminal.type} must be the last action.`);
  }

  return kernelImageApiUrl
    ? executeKernelImageComputerActions(input.actions)
    : executeHostComputerActions(input.actions);
}

async function executeKernelImageComputerActions(
  actions: z.infer<typeof computerActionInputSchema>["actions"]
) {
  const batch: z.infer<typeof computerActionInputSchema>["actions"] = [];
  let executed = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await kernelImageJson("/computer/batch", { actions: [...batch] });
    executed += batch.length;
    batch.length = 0;
  };

  for (const action of actions) {
    if (
      [
        "click_mouse",
        "drag_mouse",
        "move_mouse",
        "press_key",
        "scroll",
        "set_cursor",
        "sleep",
        "type_text",
      ].includes(action.type)
    ) {
      batch.push(action);
      continue;
    }

    await flush();
    if (action.type === "write_clipboard") {
      if (!action.write_clipboard) {
        throw new Error("write_clipboard.text is required.");
      }
      await kernelImageJson(
        "/computer/clipboard/write",
        action.write_clipboard
      );
      executed += 1;
      continue;
    }
    if (action.type === "read_clipboard") {
      return {
        data: await kernelImageJson("/computer/clipboard/read"),
        message: `Executed ${String(executed)} action(s), then read the clipboard.`,
      };
    }
    if (action.type === "get_mouse_position") {
      return {
        data: await kernelImageJson("/computer/get_mouse_position"),
        message: `Executed ${String(executed)} action(s), then read the mouse position.`,
      };
    }
    if (action.type === "screenshot") {
      const removeMask = await maskVaultFields();
      try {
        const screenshot = await kernelImageBinary(
          "/computer/screenshot",
          action.screenshot ?? {}
        );
        return {
          message: `Executed ${String(executed)} action(s), then captured a 1440x900 screenshot. Use that viewport as the coordinate space for subsequent computer actions.`,
          mimeType: "image/png" as const,
          screenshotBase64: screenshot.toString("base64"),
        };
      } finally {
        await removeMask();
      }
    }
  }

  await flush();
  return { message: `Executed ${String(executed)} action(s) successfully.` };
}

async function executeHostComputerActions(
  actions: z.infer<typeof computerActionInputSchema>["actions"]
) {
  const activePage = await getPage();
  let executed = 0;
  for (const action of actions) {
    switch (action.type) {
      case "click_mouse": {
        const value = requiredAction(action.click_mouse, "click_mouse");
        await withHeldKeys(activePage, value.hold_keys, async () => {
          mousePosition = { x: value.x, y: value.y };
          const button = value.button ?? "left";
          if (value.click_type === "down") {
            await activePage.mouse.move(value.x, value.y);
            await activePage.mouse.down({ button });
          } else if (value.click_type === "up") {
            await activePage.mouse.move(value.x, value.y);
            await activePage.mouse.up({ button });
          } else {
            await activePage.mouse.click(value.x, value.y, {
              button,
              clickCount: value.num_clicks ?? 1,
            });
          }
        });
        break;
      }
      case "move_mouse": {
        const value = requiredAction(action.move_mouse, "move_mouse");
        await activePage.mouse.move(value.x, value.y);
        mousePosition = { x: value.x, y: value.y };
        break;
      }
      case "type_text": {
        const value = requiredAction(action.type_text, "type_text");
        await activePage.keyboard.type(value.text, { delay: value.delay });
        break;
      }
      case "press_key": {
        const value = requiredAction(action.press_key, "press_key");
        await withHeldKeys(activePage, value.hold_keys, async () => {
          for (const key of value.keys) {
            await activePage.keyboard.press(normalizeKey(key), {
              delay: value.duration,
            });
          }
        });
        break;
      }
      case "scroll": {
        const value = requiredAction(action.scroll, "scroll");
        await activePage.mouse.move(value.x, value.y);
        mousePosition = { x: value.x, y: value.y };
        await activePage.mouse.wheel(value.delta_x ?? 0, value.delta_y ?? 0);
        break;
      }
      case "drag_mouse": {
        const value = requiredAction(action.drag_mouse, "drag_mouse");
        const [start, ...rest] = value.path;
        if (start?.[0] === undefined || start[1] === undefined) {
          throw new Error(
            "drag_mouse.path requires at least two [x, y] points."
          );
        }
        await activePage.mouse.move(start[0], start[1]);
        await activePage.mouse.down({ button: value.button ?? "left" });
        if (value.delay) await delay(value.delay);
        for (const point of rest) {
          if (point[0] === undefined || point[1] === undefined) {
            throw new Error(
              "Every drag_mouse path entry must be an [x, y] point."
            );
          }
          await activePage.mouse.move(point[0], point[1], {
            steps: value.steps_per_segment ?? 10,
          });
          if (value.step_delay_ms) await delay(value.step_delay_ms);
        }
        await activePage.mouse.up({ button: value.button ?? "left" });
        const end = value.path.at(-1);
        if (end?.[0] !== undefined && end[1] !== undefined) {
          mousePosition = { x: end[0], y: end[1] };
        }
        break;
      }
      case "sleep":
        await delay(requiredAction(action.sleep, "sleep").duration_ms);
        break;
      case "set_cursor":
        requiredAction(action.set_cursor, "set_cursor");
        break;
      case "write_clipboard":
        clipboardText = requiredAction(
          action.write_clipboard,
          "write_clipboard"
        ).text;
        break;
      case "read_clipboard":
        return {
          data: { text: clipboardText },
          message: `Executed ${String(executed)} action(s), then read the isolated browser clipboard.`,
        };
      case "get_mouse_position":
        return {
          data: mousePosition,
          message: `Executed ${String(executed)} action(s), then read the mouse position.`,
        };
      case "screenshot": {
        const removeMask = await maskVaultFields();
        try {
          const region = action.screenshot?.region;
          const screenshot = await activePage.screenshot({
            animations: "disabled",
            ...(region && {
              clip: {
                height: region.height,
                width: region.width,
                x: region.x,
                y: region.y,
              },
            }),
            type: "png",
          });
          const viewport = activePage.viewportSize() ?? {
            height: 900,
            width: 1440,
          };
          return {
            message: `Executed ${String(executed)} action(s), then captured a ${String(viewport.width)}x${String(viewport.height)} screenshot. Use that viewport as the coordinate space for subsequent computer actions.`,
            mimeType: "image/png" as const,
            screenshotBase64: screenshot.toString("base64"),
          };
        } finally {
          await removeMask();
        }
      }
    }
    executed += 1;
  }
  return { message: `Executed ${String(executed)} action(s) successfully.` };
}

async function executeVaultAutofill(
  input: z.infer<typeof localVaultAutofillSchema>
) {
  const activePage = await getPage();
  if (new URL(activePage.url()).origin !== input.expectedOrigin) {
    throw new Error("The active page does not match the approved origin.");
  }

  for (const field of input.fields) {
    const root = field.frameSelector
      ? activePage.frameLocator(field.frameSelector)
      : activePage;
    const selector = /^e\d+$/u.test(field.selector)
      ? `[data-local-browser-ref="${field.selector}"]`
      : field.selector;
    const element = root.locator(selector).first();
    await element.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await element.isEditable())) {
      throw new Error("An approved target is not editable.");
    }
    await element.fill(field.value);
    await element.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.dataset.vaultSecret = "true";
      }
    });
  }

  return {
    filledFields: input.fields.map(({ field }) => field),
    origin: input.expectedOrigin,
    success: true,
  };
}

async function getPage() {
  if (!context) {
    if (kernelImageCdpUrl) {
      browser = await chromium.connectOverCDP(kernelImageCdpUrl);
      context = browser.contexts()[0];
      if (!context) {
        throw new Error("The browser runtime did not expose a context.");
      }
    } else {
      mkdirSync(profileDirectory, { mode: 0o700, recursive: true });
      context = await chromium.launchPersistentContext(profileDirectory, {
        executablePath: findBrowserExecutable(),
        headless: !browserVisible,
        viewport: browserVisible ? null : { height: 900, width: 1440 },
      });
    }
    context.on("close", () => {
      browser = undefined;
      context = undefined;
      page = undefined;
    });
  }

  sessionDeleted = false;
  page =
    page && !page.isClosed()
      ? page
      : (context.pages()[0] ?? (await context.newPage()));
  return page;
}

function browserDescriptor() {
  const viewport = page?.viewportSize() ?? { height: 900, width: 1440 };
  return {
    session_id: localSessionId,
    status: sessionDeleted ? "deleted" : "active",
    viewport,
  };
}

function browserNextActions() {
  return [
    `Use execute_playwright_code with session_id "${localSessionId}" for deterministic browser automation.`,
    `Use computer_action with session_id "${localSessionId}" for visual browser control.`,
    `Use manage_browsers with action "delete" and session_id "${localSessionId}" when finished.`,
  ];
}

function requireLocalSession(sessionId: string | undefined) {
  if (!sessionId) throw new Error("session_id is required.");
  if (sessionId !== localSessionId) {
    throw new Error(`Browser session "${sessionId}" was not found.`);
  }
}

async function closeBrowserSession() {
  await context?.close().catch(() => undefined);
  browser = undefined;
  context = undefined;
  page = undefined;
}

async function kernelImageJson(path: string, body?: BrowserRuntimeRequest) {
  if (!kernelImageApiUrl)
    throw new Error("The browser runtime is unavailable.");
  const response = await fetch(new URL(path, kernelImageApiUrl), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Browser request failed (${String(response.status)}): ${await response.text()}`
    );
  }
  const text = await response.text();
  return text.length > 0 ? (JSON.parse(text) as unknown) : { success: true };
}

async function kernelImageBinary(path: string, body?: BrowserRuntimeRequest) {
  if (!kernelImageApiUrl)
    throw new Error("The browser runtime is unavailable.");
  const response = await fetch(new URL(path, kernelImageApiUrl), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Browser request failed (${String(response.status)}): ${await response.text()}`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function requiredAction<T>(value: T | undefined, action: string): T {
  if (value === undefined) {
    throw new Error(`${action} parameters are required.`);
  }
  return value;
}

async function withHeldKeys(
  activePage: Page,
  keys: readonly string[] | undefined,
  action: () => Promise<void>
) {
  const normalized = (keys ?? []).map(normalizeKey);
  for (const key of normalized) await activePage.keyboard.down(key);
  try {
    await action();
  } finally {
    for (const key of normalized.toReversed()) {
      await activePage.keyboard.up(key);
    }
  }
}

function normalizeKey(key: string) {
  return key
    .replaceAll("Ctrl", "Control")
    .replaceAll("Return", "Enter")
    .replaceAll("Escape", "Escape")
    .replaceAll("Page_Down", "PageDown")
    .replaceAll("Page_Up", "PageUp");
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.min(durationMs, 30_000));
  });
}

async function maskVaultFields() {
  const activePage = await getPage();
  const styles = await Promise.all(
    activePage.frames().map((frame) =>
      frame
        .addStyleTag({
          content:
            '[data-vault-secret="true"] { color: transparent !important; text-shadow: 0 0 8px black !important; -webkit-text-security: disc !important; }',
        })
        .catch(() => undefined)
    )
  );
  return async () => {
    for (const style of styles) {
      if (style) {
        await style
          .evaluate((element) => element.parentNode?.removeChild(element))
          .catch(() => undefined);
      }
    }
  };
}

async function inspect(activePage: Page) {
  const snapshot = await activePage.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"]'
      )
    );
    const elements = candidates
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      })
      .slice(0, 160)
      .map((element, index) => {
        const ref = `e${String(index + 1)}`;
        element.dataset.localBrowserRef = ref;
        const inputType =
          element instanceof HTMLInputElement ? element.type : undefined;
        const containsVaultValue = element.dataset.vaultSecret === "true";
        const elementText = element.innerText;
        return {
          ariaLabel: element.getAttribute("aria-label") ?? undefined,
          disabled: element.matches(":disabled"),
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          name: element.getAttribute("name") ?? undefined,
          placeholder: element.getAttribute("placeholder") ?? undefined,
          ref,
          role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
          text:
            inputType === "password" || containsVaultValue
              ? ""
              : (elementText.length > 0
                  ? elementText
                  : (element.getAttribute("value") ?? "")
                )
                  .trim()
                  .slice(0, 240),
          type: inputType,
        };
      });
    return {
      elements,
      text: document.body.innerText.slice(0, 16_000),
    };
  });

  return {
    ...snapshot,
    title: await activePage.title(),
    url: activePage.url(),
  };
}

function referencedElement(activePage: Page, ref: string) {
  return activePage.locator(`[data-local-browser-ref="${ref}"]`).first();
}

async function settle(activePage: Page) {
  await activePage
    .waitForLoadState("domcontentloaded", { timeout: 3_000 })
    .catch(() => undefined);
}

function findBrowserExecutable() {
  const configured = env.LOCAL_VAULT_ASSISTANT_BROWSER_EXECUTABLE;
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  const executable = candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate))
  );
  if (!executable) {
    throw new Error(
      "Install Chrome, Chromium, Brave, or Edge to use browser automation."
    );
  }
  return executable;
}

async function readRequestBody(request: IncomingMessage) {
  request.setEncoding("utf8");
  const chunks: string[] = [];
  let size = 0;
  for await (const chunk of request) {
    const text = String(chunk);
    size += Buffer.byteLength(text);
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(text);
  }
  return chunks.join("");
}

async function shutdown() {
  server.close();
  await closeBrowserSession();
  process.exit(0);
}
