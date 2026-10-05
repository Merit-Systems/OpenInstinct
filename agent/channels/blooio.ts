import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import { markBlooioChatRead } from "@shared/blooio/api";
import {
  acceptBlooioWebhook,
  blooioInboundAuth,
  blooioUserContent,
  claimBlooioDelivery,
} from "@agent/lib/blooio/inbound";
import {
  deliverBlooioAction,
  deliverBlooioAuthorization,
  finishBlooioTurn,
  releaseBlooioTurn,
  showBlooioTyping,
} from "@agent/lib/blooio/deliver";

const receiveTargetSchema = z.object({
  conversationId: z.string().startsWith("blooio:"),
});

export default defineChannel({
  audience({ caller }) {
    return caller.type === "principal" && caller.principal.kind === "user"
      ? "private"
      : "unknown";
  },
  events: {
    "action.result"(event, channel, session) {
      return deliverBlooioAction(event, channel, session);
    },
    async "authorization.required"(event, channel, session) {
      await deliverBlooioAuthorization(event, channel, session);
    },
    "message.completed"(event, _channel, session) {
      return finishBlooioTurn(event, session);
    },
    "session.completed"(_event, _channel, session) {
      return finishBlooioTurn({}, session);
    },
    "turn.cancelled"(_event, _channel, session) {
      return releaseBlooioTurn(
        session,
        "Scheduled result reporting was cancelled."
      );
    },
    "turn.failed"(event, _channel, session) {
      return releaseBlooioTurn(session, event.message);
    },
    "turn.started"(_event, channel, session) {
      return showBlooioTyping(channel, session);
    },
  },
  async fetchFile(url) {
    if (!url.startsWith("https://")) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 10_000_000) return null;
    const mediaType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    return mediaType ? { bytes, mediaType } : bytes;
  },
  async receive(input, { from }) {
    const target = receiveTargetSchema.parse(input.target);
    return from(target.conversationId.slice("blooio:".length)).send(
      input.message,
      { auth: input.auth }
    );
  },
  routes: [
    POST("/webhooks/blooio", async (request, { from, waitUntil }) => {
      const accepted = await acceptBlooioWebhook(request);
      if (!accepted.ok) return accepted.response;
      const message = accepted.message;
      if (!message) return new Response("ok");
      const auth = await blooioInboundAuth(message);
      if (!claimBlooioDelivery(message.messageId)) return new Response("ok");
      if (!auth) {
        console.warn("[blooio] ignoring message from an unlinked handle", {
          chatId: message.chatId,
        });
        return new Response("ok");
      }
      // Blooio retries deliveries that take longer than five seconds. Accept
      // the webhook first and run the agent turn after the response.
      waitUntil(
        (async () => {
          try {
            await markBlooioChatRead(message.chatId);
          } catch {
            // A missed read receipt should not drop the inbound turn.
          }
          try {
            await from(message.chatId).send(blooioUserContent(message), {
              auth,
            });
          } catch (error) {
            console.warn("[blooio] inbound delivery failed", {
              error,
              messageId: message.messageId,
            });
          }
        })()
      );
      return new Response("ok");
    }),
  ],
});
