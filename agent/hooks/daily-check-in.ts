import { defineHook } from "eve/hooks";
import { z } from "zod";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { ensureDailyCheckIn } from "@db/services/conversation-wakeups";

const dailyCheckInPrompt = `Run a brief OODA loop for the user: observe relevant changes in this conversation, memory, and available connected services; orient around their goals, upcoming commitments, and unfinished work; decide whether anything deserves attention; act on useful, already-authorized next steps. Keep the investigation bounded. Only contact the user when there is a meaningful finding, useful completed action, or decision that needs them. If nothing warrants attention, finish silently.`;

const destinationSchema = z.object({
  conversationChannel: z.literal("linq"),
  conversationId: z.string().startsWith("linq:"),
  linqIsDM: z.literal("true"),
});

export default defineHook({
  events: {
    async "message.received"(_event, ctx) {
      const caller = ctx.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        caller.authenticator !== "linq-message"
      )
        return;
      const destination = destinationSchema.safeParse(caller.attributes);
      if (!destination.success) return;
      await ensureDailyCheckIn(
        scopeFromPrincipal(caller),
        destination.data.conversationId,
        dailyCheckInPrompt
      );
    },
  },
});
