import type { SessionContext } from "eve/context";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import { env } from "@/lib/env";
import { isAgentcashSolanaPrivateKey } from "./agentcash-wallet";

type Session = Pick<SessionContext["session"], "auth">;

export function agentcashPrincipalId(session: Session) {
  const principal = session.auth.current ?? session.auth.initiator;
  return principal?.principalType === "user"
    ? principal.principalId
    : undefined;
}

export function agentcashWalletConfigured() {
  return Boolean(
    env.X402_PRIVATE_KEY ??
    isAgentcashSolanaPrivateKey(env.X402_SOLANA_PRIVATE_KEY)
  );
}

export function agentcashPrincipalAllowed(session: Session) {
  const principalId = agentcashPrincipalId(session);
  const allowed = new Set(
    (env.AGENTCASH_ALLOWED_USER_IDS ?? "")
      .split(/[\n,]/u)
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return principalId !== undefined && allowed.has(principalId);
}

export function requireAgentcashAccess(ctx: SessionContext) {
  const principalId = agentcashPrincipalId(ctx.session);
  if (!principalId)
    throw new Error("An authenticated user is required for Agentcash.");
  if (!agentcashPrincipalAllowed(ctx.session)) {
    throw new Error(
      "This user is not authorized for Agentcash. Call agentcash_access_status and add the returned principalId to AGENTCASH_ALLOWED_USER_IDS."
    );
  }
  if (!agentcashWalletConfigured()) {
    throw new Error(
      "Agentcash has no deployment wallet. Configure X402_PRIVATE_KEY and/or X402_SOLANA_PRIVATE_KEY."
    );
  }
  return principalId;
}

export function agentcashPaymentApproval(ctx: ApprovalContext): ApprovalStatus {
  if (!agentcashPrincipalAllowed(ctx.session)) {
    return {
      type: "denied",
      reason: "This user is not authorized for Agentcash.",
    };
  }
  if (!agentcashWalletConfigured()) {
    return {
      type: "denied",
      reason: "The Agentcash wallet is not configured.",
    };
  }
  return "user-approval";
}
