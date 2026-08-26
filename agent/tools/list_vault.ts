import { defineTool } from "eve/tools";
import { z } from "zod";
import { readManagerSnapshot } from "../../lib/server/manager-store.js";

export default defineTool({
  description:
    "List safe metadata and opaque handles for credentials stored in the local vault. Never returns secret values.",
  inputSchema: z.object({}),
  async execute() {
    const snapshot = await readManagerSnapshot();
    return snapshot.vaultItems.map(
      ({ account, hasSecret, id, kind, label }) => ({
        account,
        available: hasSecret,
        handle: id,
        kind,
        label,
      })
    );
  },
});
