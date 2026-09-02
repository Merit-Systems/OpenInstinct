import type { SessionContext } from "eve/context";
import type {
  Approval,
  ApprovalContext,
  ApprovalStatus,
} from "eve/tools/approval";
import { env } from "@/env";
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
  return principalId !== undefined && allowedUserIds.has(principalId);
}

const allowedUserIds = new Set(
  (env.AGENTCASH_ALLOWED_USER_IDS ?? "")
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter(Boolean)
);

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

function agentcashPaymentApproval(ctx: ApprovalContext): ApprovalStatus {
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

export function agentcashApprovalResponderAllowed(
  responder: { principalId: string; principalType: string },
  initiator: { principalId: string; principalType: string } | null,
  allowed = allowedUserIds
) {
  return (
    responder.principalType === "user" &&
    initiator?.principalType === "user" &&
    responder.principalId === initiator.principalId &&
    allowed.has(responder.principalId)
  );
}

export const agentcashPaymentApprovalPolicy: Approval = {
  request: agentcashPaymentApproval,
  response: ({ responder, session }) =>
    agentcashApprovalResponderAllowed(responder, session.initiator)
      ? { status: "allowed" }
      : {
          status: "rejected",
          reason:
            "Only the allowlisted user who requested this Agentcash payment may approve it.",
        },
};
