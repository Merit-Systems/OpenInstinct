import { defineTool } from "eve/tools";
import { z } from "zod";
import { readManagerVaultItems } from "@/modules/manager/server/vault";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";

export default defineTool({
  description:
    "List safe metadata and opaque handles for credentials stored in the local vault. Never returns secret values.",
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
