import { defineTool } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { readManagerSnapshot } from "@/lib/manager/server/store";

export default defineTool({
  description:
    "List safe metadata and opaque handles for credentials stored in the local vault. Never returns secret values.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) throw new Error("An authenticated user is required.");
    const snapshot = await readManagerSnapshot(scopeFromPrincipal(caller));
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
