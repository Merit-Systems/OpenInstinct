import { z } from "zod";

// Names and computer-action shapes follow Kernel's open-source MCP server.
// The session-management subset is the invariant surface every executor owns.
// Source: https://github.com/onkernel/kernel-mcp-server (MIT).

export const manageBrowsersInputSchema = z.object({
  action: z.enum(["create", "update", "list", "get", "delete"]),
  session_id: z.string().optional(),
  start_url: z.url().optional(),
  timeout_seconds: z.number().int().min(10).max(259_200).optional(),
  viewport_width: z.number().int().min(1).optional(),
  viewport_height: z.number().int().min(1).optional(),
  status: z.enum(["active", "deleted", "all"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const executePlaywrightInputSchema = z.object({
  code: z.string().min(1),
  session_id: z.string().min(1),
});

const computerActionSchema = z.object({
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
      delay: z.number().int().min(0).optional(),
    })
    .optional(),
  press_key: z
    .object({
      keys: z.array(z.string()),
      duration: z.number().int().min(0).optional(),
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
      delay: z.number().int().min(0).optional(),
      steps_per_segment: z.number().int().min(1).optional(),
      step_delay_ms: z.number().int().min(0).optional(),
      hold_keys: z.array(z.string()).optional(),
    })
    .optional(),
  set_cursor: z.object({ hidden: z.boolean() }).optional(),
  sleep: z.object({ duration_ms: z.number().int().min(0) }).optional(),
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

export const computerActionInputSchema = z.object({
  session_id: z.string().min(1),
  actions: z.array(computerActionSchema).min(1),
});

const browserResponseSchema = z.object({
  error: z.string().optional(),
  result: z.unknown().optional(),
});

type BrowserToolInput =
  | z.infer<typeof computerActionInputSchema>
  | z.infer<typeof executePlaywrightInputSchema>
  | z.infer<typeof manageBrowsersInputSchema>;

export async function runDeviceBrowserTool(
  tool: "computer_action" | "execute_playwright_code" | "manage_browsers",
  input: BrowserToolInput,
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:4275/kernel/${tool}`, {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });
  } catch {
    throw new Error("The browser runtime is unavailable.");
  }

  const body = browserResponseSchema.parse(await response.json());
  if (!response.ok) throw new Error(body.error ?? `${tool} failed.`);
  return body.result;
}
