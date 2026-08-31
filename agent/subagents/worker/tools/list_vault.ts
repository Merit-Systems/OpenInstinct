import { defineTool } from "eve/tools";
import { z } from "zod";
import { readManagerVaultItems } from "@/lib/manager/server/vault";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";

export default defineTool({
  description:
    "List safe metadata and opaque handles for saved logins, payment methods, contact or traveler details, and addresses. Check this before declaring that routine form information is missing. Never returns secret values.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const items = await readManagerVaultItems(await requireWorkerScope(ctx));
    return items.map(({ account, hasSecret, id, kind, label }) => ({
      account,
      available: hasSecret,
      handle: id,
      kind,
      label,
    }));
  },
});
