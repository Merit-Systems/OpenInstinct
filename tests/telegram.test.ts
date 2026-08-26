import { describe, expect, it, vi } from "vitest";
import {
  getTelegramUpdates,
  parseTelegramCredentials,
  prepareTelegramConnection,
} from "../lib/server/telegram";

const botToken = "123456:abcdefghijklmnopqrstuvwxyz";

describe("Telegram local input", () => {
  it("verifies the bot, disables webhooks, and creates local credentials", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              first_name: "Local Assistant",
              id: 123_456,
              is_bot: true,
              username: "local_assistant_bot",
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      );

    const connection = await prepareTelegramConnection(
      botToken,
      fetchImplementation
    );

    expect(connection.account).toBe("local_assistant_bot");
    expect(connection.endpoint).toBe("https://t.me/local_assistant_bot");
    expect(parseTelegramCredentials(connection.secret)).toMatchObject({
      botToken,
    });
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      `https://api.telegram.org/bot${botToken}/deleteWebhook`
    );
    expect(fetchImplementation.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ drop_pending_updates: false }),
      })
    );
  });

  it("long-polls from the requested update offset", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: [{ message: { text: "hello" }, update_id: 42 }],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      )
    );

    const updates = await getTelegramUpdates({
      botToken,
      fetchImplementation,
      offset: 40,
    });

    expect(updates).toEqual([{ message: { text: "hello" }, update_id: 42 }]);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      `https://api.telegram.org/bot${botToken}/getUpdates`
    );
    expect(fetchImplementation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          allowed_updates: ["message", "callback_query"],
          offset: 40,
          timeout: 25,
        }),
      })
    );
  });
});
