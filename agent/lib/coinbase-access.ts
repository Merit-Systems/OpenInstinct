import type { SessionContext } from "eve/context";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import { env } from "@/env";

type Session = Pick<SessionContext["session"], "auth">;

export function coinbasePrincipalId(session: Session) {
  const principal = session.auth.current ?? session.auth.initiator;
  return principal?.principalType === "user"
    ? principal.principalId
    : undefined;
}

function allowedUserIds() {
  return new Set(
    (env.COINBASE_ALLOWED_USER_IDS ?? "")
      .split(/[\n,]/u)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function coinbasePrincipalAllowed(session: Session) {
  const principalId = coinbasePrincipalId(session);
  return principalId !== undefined && allowedUserIds().has(principalId);
}

export function requireCoinbaseAccess(ctx: SessionContext) {
  const principalId = coinbasePrincipalId(ctx.session);
  if (!principalId)
    throw new Error("An authenticated user is required for Coinbase.");
  if (!coinbasePrincipalAllowed(ctx.session)) {
    throw new Error(
      "This user is not authorized for Coinbase. Call coinbase_access_status and add the returned principalId to COINBASE_ALLOWED_USER_IDS."
    );
  }
  return principalId;
}

export function coinbaseApproval(
  ctx: ApprovalContext,
  requiresUserApproval: boolean
): ApprovalStatus {
  if (!coinbasePrincipalAllowed(ctx.session)) {
    return {
      type: "denied",
      reason: "This user is not authorized for Coinbase.",
    };
  }
  return requiresUserApproval ? "user-approval" : "not-applicable";
}
