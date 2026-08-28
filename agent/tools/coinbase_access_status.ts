import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  coinbasePrincipalAllowed,
  coinbasePrincipalId,
} from "../lib/coinbase-access";
import { coinbaseCredentialsConfigured } from "../lib/coinbase-cli";

export default defineTool({
  description:
    "Show whether Coinbase for Agents is configured and whether the current authenticated user is allowlisted. Never returns credentials or account data.",
  inputSchema: z.object({}).strict(),
  execute(_input, ctx) {
    const principalId = coinbasePrincipalId(ctx.session);
    return {
      allowed: coinbasePrincipalAllowed(ctx.session),
      credentialsConfigured: coinbaseCredentialsConfigured(),
      principalId,
      requiredConfiguration: {
        allowedUsers: "COINBASE_ALLOWED_USER_IDS",
        keyId: "COINBASE_KEY_ID",
        keySecret: "COINBASE_KEY_SECRET",
      },
    };
  },
});
