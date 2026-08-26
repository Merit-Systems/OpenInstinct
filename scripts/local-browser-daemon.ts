import { existsSync, mkdirSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { z } from "zod";
import {
  localBrowserActionSchema,
  localVaultAutofillSchema,
} from "../lib/local-browser.ts";
import { getEnv } from "../lib/runtime-env.ts";

const browserPort = 4275;
const env = getEnv();
const profileDirectory = join(
  env.LOCAL_VAULT_ASSISTANT_DATA_DIR ??
    join(homedir(), ".local-vault-assistant"),
  "browser-profile"
);
let context: BrowserContext | undefined;
let page: Page | undefined;

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
    !["/action", "/vault-fill"].includes(request.url ?? "") ||
    request.socket.remoteAddress !== "127.0.0.1"
  ) {
    response.writeHead(404).end(JSON.stringify({ error: "Not found." }));
    return;
  }

  try {
    const body: unknown = JSON.parse(await readRequestBody(request));
    const result =
      request.url === "/vault-fill"
        ? await executeVaultAutofill(localVaultAutofillSchema.parse(body))
        : await execute(localBrowserActionSchema.parse(body));
    response.writeHead(200).end(JSON.stringify({ result }));
  } catch (error) {
    response.writeHead(400).end(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "The local browser action failed.",
      })
    );
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
        node.dataset.localBrowserSecret = "true";
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
    mkdirSync(profileDirectory, { mode: 0o700, recursive: true });
    context = await chromium.launchPersistentContext(profileDirectory, {
      executablePath: findBrowserExecutable(),
      headless: false,
      viewport: null,
    });
    context.on("close", () => {
      context = undefined;
      page = undefined;
    });
  }

  page =
    page && !page.isClosed()
      ? page
      : (context.pages()[0] ?? (await context.newPage()));
  return page;
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
        const containsVaultValue =
          element.dataset.localBrowserSecret === "true";
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
      "Install Chrome, Chromium, Brave, or Edge to use the local browser."
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
  await context?.close().catch(() => undefined);
  process.exit(0);
}
