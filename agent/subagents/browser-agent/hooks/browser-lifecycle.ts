import { defineHook } from "eve/hooks";
import { listWorkerBrowserSessions } from "@db/services/browsers";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { retireBrowserSession } from "../lib/lifecycle/retire";

export default defineHook({
  events: {
    async "session.ended"(_event, ctx) {
      const caller = ctx.session.auth.initiator ?? ctx.session.auth.current;
      if (!caller) return;
      const scope = scopeFromPrincipal(caller);
      const browsers = await listWorkerBrowserSessions(scope, ctx.session.id);
      // The ended occurrence may already be aborted. Retirement owns fresh
      // deadlines and keeps ownership records when provider release fails.
      const retired = await Promise.allSettled(
        browsers.map((browser) =>
          retireBrowserSession(scope, ctx.session.id, browser)
        )
      );
      const failures: unknown[] = [];
      for (const result of retired) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          "Some worker browsers could not be retired."
        );
    },
  },
});
