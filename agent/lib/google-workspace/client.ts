import { connect, type EveAuthorizationOptions } from "@vercel/connect/eve";
import type { ToolContext } from "eve/tools";
import type { output, ZodType } from "zod";
import {
  GOOGLE_WORKSPACE_CONNECTOR,
  googleWorkspaceSubject,
  GOOGLE_WORKSPACE_SCOPES,
} from "@/lib/google-workspace/config";

export const googleWorkspaceAuthOptions = {
  connector: GOOGLE_WORKSPACE_CONNECTOR,
  createSubject(principal) {
    if (principal.type !== "user") {
      throw new Error(
        "Google Workspace requires an authenticated OpenInstinct user."
      );
    }
    return googleWorkspaceSubject(principal.id);
  },
  tokenParams: { scopes: [...GOOGLE_WORKSPACE_SCOPES] },
  validate: true,
} satisfies EveAuthorizationOptions;

const googleWorkspaceAuth = connect(googleWorkspaceAuthOptions);

export async function googleWorkspaceFetch<TSchema extends ZodType>(
  ctx: ToolContext,
  url: string,
  schema: TSchema,
  init: RequestInit = {}
): Promise<output<TSchema>> {
  const { token } = await ctx.getToken(googleWorkspaceAuth);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers,
    signal: ctx.abortSignal,
  });

  if (response.status === 401) ctx.requireAuth(googleWorkspaceAuth);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Google Workspace returned HTTP ${String(response.status)}: ${detail.slice(0, 500)}`
    );
  }
  const body: unknown =
    response.status === 204 ? undefined : await response.json();
  return schema.parse(body);
}

export function decodeBase64Url(value: string) {
  return Buffer.from(
    value.replace(/-/gu, "+").replace(/_/gu, "/"),
    "base64"
  ).toString("utf8");
}

export function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

const secretPatterns: readonly (readonly [RegExp, string])[] = [
  [/\b\d{6}\b/gu, "[six-digit code redacted]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gu, "[api key redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "[github token redacted]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[aws key redacted]"],
  [/\bAIza[A-Za-z0-9_-]{30,}\b/gu, "[google api key redacted]"],
  [/\b(?:bearer\s+)[A-Za-z0-9._~+/-]+=*\b/giu, "Bearer [token redacted]"],
  [
    /\b(password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    "$1=[credential redacted]",
  ],
  [/\b(?:\d[ -]*?){13,19}\b/gu, "[payment number redacted]"],
];

export function redactGoogleText(value: string, maxLength = 12_000) {
  let redacted = value.slice(0, maxLength);
  for (const [pattern, replacement] of secretPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
