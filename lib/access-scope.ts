import { createHash } from "node:crypto";
import type { ConnectionPrincipal } from "eve/connections";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

const principalScopeSchema = z.object({
  attributes: z.object({
    mode: z.enum(["hosted", "local"]),
    workspaceId: z.string().min(1),
  }),
  id: z.string().min(1).optional(),
  principalId: z.string().min(1).optional(),
});

export const localAccessScope = {
  mode: "local",
  userId: "local:user",
  workspaceId: "local:personal",
} as const satisfies AccessScope;

export interface AccessScope {
  readonly mode: "hosted" | "local";
  readonly userId: string;
  readonly workspaceId: string;
}

export function accessScopeForUser(userId: string): AccessScope {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("An authenticated user is required.");

  return {
    mode: "hosted",
    userId: normalizedUserId,
    workspaceId: `personal:${createHash("sha256")
      .update(normalizedUserId)
      .digest("hex")
      .slice(0, 32)}`,
  };
}

export function scopeFromPrincipal(
  input: SessionAuthContext | Extract<ConnectionPrincipal, { type: "user" }>
) {
  const principal = principalScopeSchema.parse(input);
  const userId = principal.id ?? principal.principalId;
  if (!userId) {
    throw new Error("An authenticated workspace user is required.");
  }

  return {
    mode: principal.attributes.mode,
    userId,
    workspaceId: principal.attributes.workspaceId,
  } satisfies AccessScope;
}
