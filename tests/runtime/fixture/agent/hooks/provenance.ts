import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineHook } from "eve/hooks";

export default defineHook({
  events: {
    async "message.received"(event, context) {
      if (context.session.parent) return;
      await writeFile(
        join(
          ".eve",
          "fixture-memory",
          context.session.id,
          `${event.data.turnId}.receipt.json`
        ),
        JSON.stringify({
          kind: event.data.kind ?? "user",
          observedAt: event.meta.at,
        })
      );
    },
  },
});
