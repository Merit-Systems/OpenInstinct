import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "@shared/environment";

const sessionSchema = z.object({
  session_id: z.string().min(1),
  created_at: z.string(),
  status: z.enum(["active", "closed", "error", "timed_out"]),
  cdp_url: z.url().nullish(),
  viewer_url: z.url().nullish(),
  viewport_width: z.number().nullish(),
  viewport_height: z.number().nullish(),
});
const profileSchema = z.object({
  profile_id: z.string(),
  name: z.string().nullable(),
});

// Keep provider and write mode in the existing opaque session ID. This also
// prevents a provider switch from sending old sessions to the wrong service.
export function notteSessionId(id: string, writable: boolean) {
  return `notte:${writable ? "write" : "read"}:${id}`;
}

export function isNotteSession(id: string) {
  return id.startsWith("notte:");
}

function remoteSessionId(id: string) {
  const match = /^notte:(?:read|write):(.+)$/u.exec(id);
  if (!match?.[1]) throw new Error("Invalid Notte browser session ID.");
  return encodeURIComponent(match[1]);
}

async function request(
  path: string,
  method: string,
  body?: z.infer<ReturnType<typeof z.json>>,
  signal?: AbortSignal
) {
  if (!env.NOTTE_API_KEY)
    throw new Error("NOTTE_API_KEY is required for Notte browsers.");
  const response = await fetch(`https://api.notte.cc${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTTE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    // Do not expose response bodies, which can include connection credentials.
    throw Object.assign(
      new Error(`Notte request failed (HTTP ${String(response.status)}).`),
      { status: response.status }
    );
  }
  const value: unknown = await response.json();
  return value;
}

export async function ensureNotteProfile(
  workspaceId: string,
  signal?: AbortSignal
) {
  const name = `openinstinct-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 40)}`;
  const profiles = z
    .object({ items: z.array(profileSchema) })
    .parse(
      await request(
        `/profiles?name=${name}&page_size=100`,
        "GET",
        undefined,
        signal
      )
    );
  const existing = profiles.items.find((profile) => profile.name === name);
  if (existing) return existing.profile_id;
  return profileSchema.parse(
    await request("/profiles/create", "POST", { name }, signal)
  ).profile_id;
}

export async function startNotteBrowser(
  input: {
    profileId: string;
    writable: boolean;
    timeoutSeconds: number;
    viewport?: { width: number; height: number };
  },
  signal?: AbortSignal
) {
  if (input.timeoutSeconds > 1800)
    throw new Error("Notte idle timeout cannot exceed 1800 seconds.");
  const session = sessionSchema.parse(
    await request(
      "/sessions/start",
      "POST",
      {
        browser_type: "chromium",
        proxies: false,
        solve_captchas: true,
        idle_timeout_minutes: Math.ceil(input.timeoutSeconds / 60),
        max_duration_minutes: 1440,
        profile: { id: input.profileId, persist: input.writable },
        viewport_width: input.viewport?.width ?? null,
        viewport_height: input.viewport?.height ?? null,
      },
      signal
    )
  );
  return descriptor(
    session,
    notteSessionId(session.session_id, input.writable)
  );
}

export async function retrieveNotteBrowser(id: string, signal?: AbortSignal) {
  const session = sessionSchema.parse(
    await request(`/sessions/${remoteSessionId(id)}`, "GET", undefined, signal)
  );
  return descriptor(session, id);
}

export async function stopNotteBrowser(id: string, signal?: AbortSignal) {
  await request(
    `/sessions/${remoteSessionId(id)}/stop`,
    "DELETE",
    undefined,
    signal
  );
}

function descriptor(session: z.infer<typeof sessionSchema>, id: string) {
  return {
    session_id: id,
    created_at: session.created_at,
    cdp_ws_url: session.cdp_url ?? undefined,
    browser_live_view_url: session.viewer_url ?? undefined,
    status: session.status === "active" ? "active" : "deleted",
    profile_save_changes: id.startsWith("notte:write:"),
    viewport:
      session.viewport_width && session.viewport_height
        ? { width: session.viewport_width, height: session.viewport_height }
        : undefined,
  };
}

export async function notteCdpUrl(id: string, signal?: AbortSignal) {
  const browser = await retrieveNotteBrowser(id, signal);
  if (browser.status !== "active")
    throw new Error("Notte browser is closed. Create a new session.");
  if (browser.cdp_ws_url) return browser.cdp_ws_url;
  const debug = z
    .object({ ws: z.object({ cdp: z.url() }) })
    .parse(
      await request(
        `/sessions/${remoteSessionId(id)}/debug`,
        "GET",
        undefined,
        signal
      )
    );
  return debug.ws.cdp;
}
