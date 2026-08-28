import { kernel } from "@/lib/kernel";

export async function withVaultScreenshotMask<T>(
  sessionId: string,
  signal: AbortSignal | undefined,
  capture: () => Promise<T>
) {
  await setVaultScreenshotMask(sessionId, "add", signal);
  try {
    return await capture();
  } finally {
    await setVaultScreenshotMask(sessionId, "remove", undefined).catch(
      () => undefined
    );
  }
}

export async function withVaultBrowserObservationMask<T>(
  sessionId: string,
  signal: AbortSignal | undefined,
  observe: () => Promise<T>
) {
  await setVaultAccessibilityMask(sessionId, "add", signal);
  try {
    return await observe();
  } finally {
    await setVaultAccessibilityMask(sessionId, "remove", undefined).catch(
      () => undefined
    );
  }
}

async function setVaultScreenshotMask(
  sessionId: string,
  action: "add" | "remove",
  signal?: AbortSignal
) {
  const styleId = "vault-screenshot-mask";
  const selector = '[data-vault-secret="true"]';
  const operation =
    action === "add"
      ? `
        const existing = document.getElementById(styleId);
        if (existing) {
          const refs = Number.parseInt(existing.dataset.vaultMaskRefs || "0", 10);
          existing.dataset.vaultMaskRefs = String((Number.isFinite(refs) ? refs : 0) + 1);
        } else {
          const style = document.createElement("style");
          style.id = styleId;
          style.dataset.vaultMaskRefs = "1";
          style.textContent = selector + " { color: transparent !important; text-shadow: 0 0 8px black !important; -webkit-text-security: disc !important; }";
          document.documentElement.append(style);
        }`
      : `
        const style = document.getElementById(styleId);
        if (style) {
          const refs = Number.parseInt(style.dataset.vaultMaskRefs || "1", 10);
          const remainingRefs = Math.max(0, (Number.isFinite(refs) ? refs : 1) - 1);
          if (remainingRefs > 0) {
            style.dataset.vaultMaskRefs = String(remainingRefs);
          } else {
            style.remove();
          }
        }`;
  await runMaskOperation(
    sessionId,
    operation,
    { selector, styleId },
    action,
    signal
  );
}

async function setVaultAccessibilityMask(
  sessionId: string,
  action: "add" | "remove",
  signal?: AbortSignal
) {
  const selector = '[data-vault-secret="true"]';
  const operation =
    action === "add"
      ? `
        for (const element of document.querySelectorAll(selector)) {
          const stalePrevious = element.dataset.vaultPreviousAriaHidden;
          if (stalePrevious === "__absent__") element.removeAttribute("aria-hidden");
          else if (stalePrevious !== undefined) element.setAttribute("aria-hidden", stalePrevious);
          element.dataset.vaultPreviousAriaHidden = element.hasAttribute("aria-hidden")
            ? element.getAttribute("aria-hidden") || ""
            : "__absent__";
          element.setAttribute("aria-hidden", "true");
        }`
      : `
        for (const element of document.querySelectorAll(selector)) {
          const previous = element.dataset.vaultPreviousAriaHidden;
          if (previous === "__absent__") element.removeAttribute("aria-hidden");
          else if (previous !== undefined) element.setAttribute("aria-hidden", previous);
          delete element.dataset.vaultPreviousAriaHidden;
        }`;
  await runMaskOperation(sessionId, operation, { selector }, action, signal);
}

async function runMaskOperation(
  sessionId: string,
  operation: string,
  parameters: Record<string, string>,
  action: "add" | "remove",
  signal?: AbortSignal
) {
  const code = `
for (const currentContext of browser.contexts()) {
  for (const currentPage of currentContext.pages()) {
    for (const frame of currentPage.frames()) {
      await frame.evaluate((parameters) => {
        const { selector, styleId } = parameters;
        ${operation}
      }, ${JSON.stringify(parameters)}).catch(() => undefined);
    }
  }
}
return true;`;
  const result = await kernel.browsers.playwright.execute(
    sessionId,
    { code, timeout_sec: 10 },
    { signal }
  );
  if (!result.success) {
    throw new Error(
      action === "add"
        ? "Vault fields could not be masked for browser observation."
        : "Vault browser masking could not be removed."
    );
  }
}
