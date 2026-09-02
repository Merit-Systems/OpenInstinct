import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  agentcashPrincipalAllowed,
  agentcashPrincipalId,
  agentcashWalletConfigured,
} from "../lib/agentcash-access";
import { isAgentcashSolanaPrivateKey } from "../lib/agentcash-wallet";
import { env } from "@/lib/env";

export default defineTool({
  description:
    "Show whether Agentcash x402 access is configured and whether the current authenticated user is allowlisted. Never returns private keys.",
  inputSchema: z.object({}).strict(),
  execute(_input, ctx) {
    return {
      allowed: agentcashPrincipalAllowed(ctx.session),
      maximumPaymentUsd: env.AGENTCASH_MAX_PAYMENT_USD,
      principalId: agentcashPrincipalId(ctx.session),
      supportedWallets: {
        evm: Boolean(env.X402_PRIVATE_KEY),
        solana: isAgentcashSolanaPrivateKey(env.X402_SOLANA_PRIVATE_KEY),
      },
      walletConfigured: agentcashWalletConfigured(),
      requiredConfiguration: {
        allowedUsers: "AGENTCASH_ALLOWED_USER_IDS",
        evmPrivateKey: "X402_PRIVATE_KEY",
        solanaPrivateKey: "X402_SOLANA_PRIVATE_KEY",
      },
    };
  },
});
