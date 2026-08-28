import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { kernel } from "@/lib/kernel";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";

const actionSchema = z.object({
  type: z.enum([
    "click_mouse",
    "move_mouse",
    "type_text",
    "press_key",
    "scroll",
    "drag_mouse",
    "set_cursor",
    "sleep",
    "write_clipboard",
    "read_clipboard",
    "screenshot",
    "get_mouse_position",
  ]),
  click_mouse: z
    .object({
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "right", "middle"]).optional(),
      click_type: z.enum(["down", "up", "click"]).optional(),
      num_clicks: z.number().int().min(1).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  move_mouse: z
    .object({
      x: z.number(),
      y: z.number(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  type_text: z
    .object({
      text: z.string(),
      delay: z.number().int().min(0).max(250).optional(),
    })
    .optional(),
  press_key: z
    .object({
      keys: z.array(z.string()),
      duration: z.number().int().min(0).max(2_000).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  scroll: z
    .object({
      x: z.number(),
      y: z.number(),
      delta_x: z.number().optional(),
      delta_y: z.number().optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  drag_mouse: z
    .object({
      path: z.array(z.array(z.number()).length(2)).min(2),
      button: z.enum(["left", "middle", "right"]).optional(),
      delay: z.number().int().min(0).max(2_000).optional(),
      steps_per_segment: z.number().int().min(1).optional(),
      step_delay_ms: z.number().int().min(0).max(250).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  set_cursor: z.object({ hidden: z.boolean() }).optional(),
  sleep: z
    .object({ duration_ms: z.number().int().min(0).max(2_000) })
    .optional(),
  write_clipboard: z.object({ text: z.string() }).optional(),
  screenshot: z
    .object({
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().int().min(1),
          height: z.number().int().min(1),
        })
        .optional(),
    })
    .optional(),
});

const inputSchema = z.object({
  session_id: z.string().min(1),
  actions: z.array(actionSchema).min(1),
});

const outputSchema = z.object({
  data: z.unknown().optional(),
  message: z.string(),
  mimeType: z.literal("image/png").optional(),
  screenshotBase64: z.string().optional(),
});

export default defineTool({
  description:
    "Execute a bounded batch of computer actions on one browser session. Prefer one batch over repeated calls, keep sleep actions at or below two seconds, and include a screenshot last only when visual inspection is needed; screenshots are delivered directly to the vision model.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);

    const computer = kernel.browsers.computer;
    const data: unknown[] = [];
    let screenshotBase64: string | undefined;

    for (const action of input.actions) {
      switch (action.type) {
        case "click_mouse":
          await computer.clickMouse(
            input.session_id,
            requiredAction(action.click_mouse, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "move_mouse":
          await computer.moveMouse(
            input.session_id,
            requiredAction(action.move_mouse, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "type_text":
          await computer.typeText(
            input.session_id,
            requiredAction(action.type_text, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "press_key":
          await computer.pressKey(
            input.session_id,
            requiredAction(action.press_key, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "scroll":
          await computer.scroll(
            input.session_id,
            requiredAction(action.scroll, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "drag_mouse":
          await computer.dragMouse(
            input.session_id,
            requiredAction(action.drag_mouse, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "set_cursor":
          data.push(
            await computer.setCursorVisibility(
              input.session_id,
              requiredAction(action.set_cursor, action.type),
              { signal: context.abortSignal }
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
            { signal: context.abortSignal }
          );
          break;
        case "write_clipboard":
          await computer.writeClipboard(
            input.session_id,
            requiredAction(action.write_clipboard, action.type),
            { signal: context.abortSignal }
          );
          break;
        case "read_clipboard":
          data.push(
            await computer.readClipboard(input.session_id, {
              signal: context.abortSignal,
            })
          );
          break;
        case "get_mouse_position":
          data.push(
            await computer.getMousePosition(input.session_id, {
              signal: context.abortSignal,
            })
          );
          break;
        case "screenshot": {
          const removeMask = await maskVaultFields(
            input.session_id,
            context.abortSignal
          );
          try {
            const response = await computer.captureScreenshot(
              input.session_id,
              action.screenshot,
              { signal: context.abortSignal }
            );
            screenshotBase64 = Buffer.from(
              await response.arrayBuffer()
            ).toString("base64");
          } finally {
            await removeMask();
          }
          break;
        }
      }
    }

    return outputSchema.parse({
      data: data.length > 0 ? data : undefined,
      message: `Executed ${String(input.actions.length)} computer action${input.actions.length === 1 ? "" : "s"}.`,
      mimeType: screenshotBase64 ? "image/png" : undefined,
      screenshotBase64,
    });
  },
  toModelOutput(output) {
    if (!output.screenshotBase64) {
      return toolOutput.json({
        data: output.data,
        message: output.message,
      });
    }
    return toolOutput.content([
      toolOutputPart.text(output.message),
      toolOutputPart.file(output.screenshotBase64, {
        mediaType: output.mimeType ?? "image/png",
      }),
    ]);
  },
});

function requiredAction<T>(value: T | undefined, action: string): T {
  if (value === undefined) {
    throw new Error(`Computer action ${action} is missing its payload.`);
  }
  return value;
}

async function maskVaultFields(sessionId: string, signal?: AbortSignal) {
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
  await kernel.browsers.playwright.execute(
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
    await kernel.browsers.playwright
      .execute(sessionId, { code: removeCode, timeout_sec: 10 }, { signal })
      .catch(() => undefined);
  };
}
