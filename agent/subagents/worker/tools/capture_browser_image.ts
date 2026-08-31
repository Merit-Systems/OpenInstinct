import { randomUUID } from "node:crypto";
import { defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import { withVaultScreenshotMask } from "@/agent/subagents/worker/lib/vault-screenshot-mask";
import { reserveBrowserImageArtifact } from "@/db/services/browser-images";
import {
  browserImageArtifactReferenceSchema,
  safeBrowserImageFilename,
  sniffBrowserImageMediaType,
} from "@/lib/browser-images";
import {
  persistReservedBrowserImage,
  readBoundedResponse,
} from "@/lib/browser-images/server";
import { kernel } from "@/lib/kernel";

const regionSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});
const commonFields = {
  label: z.string().trim().min(1).max(200),
  session_id: z.string().min(1),
};
const inputSchema = z.discriminatedUnion("source", [
  z.object({
    ...commonFields,
    region: regionSchema.optional(),
    source: z.literal("viewport"),
  }),
  z.object({
    ...commonFields,
    source: z.literal("full_page"),
  }),
  z.object({
    ...commonFields,
    selector: z.string().trim().min(1).max(2_000),
    source: z.literal("element"),
  }),
  z.object({
    ...commonFields,
    selector: z.string().trim().min(1).max(2_000),
    source: z.literal("image_resource"),
  }),
]);
const outputSchema = z.object({ image: browserImageArtifactReferenceSchema });

type CaptureInput = z.infer<typeof inputSchema>;

export default defineTool({
  description:
    "Capture one durable, user-visible image from an owned browser. Use only when the assignment requests an image or one image materially improves the final result; never persist routine debugging screenshots. Supports viewport or region screenshots, full-page screenshots, rendered element screenshots, and original image resources selected from the current page. Original resource capture falls back to the rendered element when needed. Does not expose private Blob URLs or page credentials.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);
    const parent = context.session.parent;
    if (!parent)
      throw new Error("Browser image capture requires a delegated worker.");

    const reserved = await reserveBrowserImageArtifact(scope, {
      browserSessionId: input.session_id,
      idempotencyKey: `browser-image:${context.session.id}:${context.callId}`,
      label: input.label,
      rootSessionId: parent.rootSessionId,
      sourceKind: input.source,
      workerSessionId: context.session.id,
    });
    if (reserved.status === "ready") return { image: reserved.image };

    const captured = await captureBrowserImage(input, context.abortSignal);
    const mediaType = sniffBrowserImageMediaType(captured.bytes);
    if (!mediaType) {
      throw new Error(
        "The captured resource is not a supported browser image."
      );
    }
    const image = await persistReservedBrowserImage(
      scope,
      reserved.reservation,
      {
        bytes: captured.bytes,
        filename: safeBrowserImageFilename(input.label, mediaType),
        sourceKind: captured.sourceKind,
      },
      context.abortSignal
    );
    return outputSchema.parse({ image });
  },
  toModelOutput(output) {
    return toolOutput.json({ image: output.image });
  },
});

async function captureBrowserImage(
  input: CaptureInput,
  signal?: AbortSignal
): Promise<{ bytes: Uint8Array; sourceKind: CaptureInput["source"] }> {
  switch (input.source) {
    case "viewport": {
      const response = await withVaultScreenshotMask(
        input.session_id,
        signal,
        async () =>
          kernel.browsers.computer.captureScreenshot(
            input.session_id,
            input.region ? { region: input.region } : undefined,
            { signal }
          )
      );
      return {
        bytes: await readBoundedResponse(response),
        sourceKind: input.source,
      };
    }
    case "full_page":
      return {
        bytes: await capturePlaywrightScreenshot(
          input.session_id,
          { kind: "full_page" },
          signal
        ),
        sourceKind: input.source,
      };
    case "element":
      return {
        bytes: await capturePlaywrightScreenshot(
          input.session_id,
          { kind: "element", selector: input.selector },
          signal
        ),
        sourceKind: input.source,
      };
    case "image_resource":
      try {
        return {
          bytes: await captureImageResource(
            input.session_id,
            input.selector,
            signal
          ),
          sourceKind: input.source,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          bytes: await capturePlaywrightScreenshot(
            input.session_id,
            { kind: "element", selector: input.selector },
            signal
          ),
          sourceKind: "element",
        };
      }
  }
}

async function captureImageResource(
  sessionId: string,
  selector: string,
  signal?: AbortSignal
) {
  const result = await kernel.browsers.playwright.execute(
    sessionId,
    {
      code: `
const image = page.locator(${JSON.stringify(selector)}).first();
await image.waitFor({ state: "visible", timeout: 5_000 });
return await image.evaluate((element) => {
  if (!(element instanceof HTMLImageElement)) {
    throw new Error("The selected element is not an image.");
  }
  return { url: element.currentSrc || element.src };
});`,
      timeout_sec: 10,
    },
    { signal }
  );
  const resolved = z
    .object({ url: z.url() })
    .safeParse(result.success ? result.result : undefined);
  if (!resolved.success) {
    throw new Error(
      result.error ?? "The selected image resource was unavailable."
    );
  }
  const url = new URL(resolved.data.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The selected image does not use an HTTP URL.");
  }

  await kernel.browsers.retrieve(sessionId, {}, { signal });
  const response = await kernel.browsers.fetch(sessionId, url, {
    headers: {
      accept: "image/webp,image/png,image/jpeg,image/gif,*/*;q=0.1",
    },
    method: "GET",
    signal,
    timeout_ms: 20_000,
  });
  if (!response.ok) {
    throw new Error(
      `The selected image resource returned HTTP ${String(response.status)}.`
    );
  }
  const bytes = await readBoundedResponse(response);
  if (!sniffBrowserImageMediaType(bytes)) {
    throw new Error("The selected resource is not a supported image.");
  }
  return bytes;
}

async function capturePlaywrightScreenshot(
  sessionId: string,
  target:
    | { readonly kind: "full_page" }
    | { readonly kind: "element"; readonly selector: string },
  signal?: AbortSignal
) {
  const operationKey = randomUUID();
  const remotePath = `/tmp/openinstinct-browser-image-${operationKey}.png`;

  return withVaultScreenshotMask(sessionId, signal, async () => {
    try {
      const screenshotCode =
        target.kind === "full_page"
          ? `await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true, path: ${JSON.stringify(remotePath)}, type: "png" });`
          : `
const target = page.locator(${JSON.stringify(target.selector)}).first();
await target.waitFor({ state: "visible", timeout: 5_000 });
await target.screenshot({ animations: "disabled", caret: "hide", path: ${JSON.stringify(remotePath)}, type: "png" });`;
      const result = await kernel.browsers.playwright.execute(
        sessionId,
        { code: `${screenshotCode}\nreturn true;`, timeout_sec: 25 },
        { signal }
      );
      if (!result.success) {
        throw new Error(
          result.error ?? "Kernel could not capture the screenshot."
        );
      }
      const response = await kernel.browsers.fs.readFile(
        sessionId,
        { path: remotePath },
        { signal }
      );
      return await readBoundedResponse(response);
    } finally {
      await kernel.browsers.fs
        .deleteFile(sessionId, { path: remotePath })
        .catch(() => undefined);
    }
  });
}
