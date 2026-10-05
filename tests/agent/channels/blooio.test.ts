import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blooioSignatureHeader } from "@agent/lib/blooio/signature";

const capture = vi.hoisted(() => ({
  findOne:
    vi.fn<() => Promise<{ id: string; phoneNumberVerified: boolean } | null>>(),
}));

vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({ adapter: { findOne: capture.findOne } }),
  }),
}));

const requiredEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnop",
  BETTER_AUTH_URL: "https://example.com",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
  BLOOIO_API_KEY: "bl_test",
  BLOOIO_WEBHOOK_SECRET: "whsec_test",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
};

const inboundPayload = {
  data: {
    attachments: [],
    channel_address: "+15559876543",
    chat_id: "chat_018f7b2a-77aa-7c22-9d3e-4f5a6b7c8d9e",
    contact: { identifier: "+15551234567" },
    direction: "inbound",
    message_id: "msg_xyz789",
    sender: "+15551234567",
    text: "Book the 7:15 show",
  },
  id: "evt_test",
  type: "message.received",
};

describe("Blooio webhooks", () => {
  beforeEach(() => {
    vi.resetModules();
    capture.findOne.mockReset();
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a webhook when Blooio is not configured", async () => {
    vi.stubEnv("BLOOIO_API_KEY", "");
    const { acceptBlooioWebhook } = await import("@agent/lib/blooio/inbound");

    const accepted = await acceptBlooioWebhook(signedRequest("{}"));

    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.response.status).toBe(404);
  });

  it("rejects a webhook with a bad signature", async () => {
    const { acceptBlooioWebhook } = await import("@agent/lib/blooio/inbound");
    const request = new Request("https://assistant.example/webhooks/blooio", {
      body: JSON.stringify(inboundPayload),
      headers: { "x-blooio-signature": "t=1,v1=deadbeef" },
      method: "POST",
    });

    const accepted = await acceptBlooioWebhook(request);

    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.response.status).toBe(401);
  });

  it("ignores outbound and non-message events", async () => {
    const { acceptBlooioWebhook } = await import("@agent/lib/blooio/inbound");

    const delivered = await acceptBlooioWebhook(
      signedRequest(
        JSON.stringify({ ...inboundPayload, type: "message.delivered" })
      )
    );
    const outbound = await acceptBlooioWebhook(
      signedRequest(
        JSON.stringify({
          ...inboundPayload,
          data: { ...inboundPayload.data, direction: "outbound" },
        })
      )
    );

    expect(delivered).toEqual({ ok: true });
    expect(outbound).toEqual({ ok: true });
  });

  it("scopes a verified sender to that user's workspace", async () => {
    capture.findOne.mockResolvedValue({
      id: "user-1",
      phoneNumberVerified: true,
    });
    const { acceptBlooioWebhook, blooioInboundAuth } =
      await import("@agent/lib/blooio/inbound");
    const accepted = await acceptBlooioWebhook(
      signedRequest(JSON.stringify(inboundPayload))
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || !accepted.message) {
      throw new Error("Expected an inbound Blooio message.");
    }

    const auth = await blooioInboundAuth(accepted.message);

    expect(capture.findOne).toHaveBeenCalledExactlyOnceWith({
      model: "user",
      where: [{ field: "phoneNumber", value: "+15551234567" }],
    });
    expect(auth?.principalId).toBe("better-auth:user-1");
    expect(auth?.attributes).toMatchObject({
      blooioChatId: inboundPayload.data.chat_id,
      blooioMessageId: inboundPayload.data.message_id,
      conversationChannel: "blooio",
      conversationId: `blooio:${inboundPayload.data.chat_id}`,
      phoneNumber: "+15551234567",
    });
    expect(auth?.attributes.workspaceId).toMatch(/^personal:[0-9a-f]{32}$/);
  });

  it("drops a sender that is not a verified user", async () => {
    capture.findOne.mockResolvedValue(null);
    const { acceptBlooioWebhook, blooioInboundAuth } =
      await import("@agent/lib/blooio/inbound");
    const accepted = await acceptBlooioWebhook(
      signedRequest(JSON.stringify(inboundPayload))
    );
    if (!accepted.ok || !accepted.message) {
      throw new Error("Expected an inbound Blooio message.");
    }

    await expect(blooioInboundAuth(accepted.message)).resolves.toBeUndefined();
  });
});

describe("Blooio API client", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a chat message with an idempotency key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_out", chat_id: "chat_1" }), {
        status: 201,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendBlooioChatMessage } = await import("@shared/blooio/api");

    await sendBlooioChatMessage(
      "chat_1",
      { reply_to: "msg_in", text: "On it." },
      "scheduled-report:run:1"
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.blooio.com/v4/chats/chat_1/messages");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer bl_test");
    expect(headers.get("Idempotency-Key")).toBe("scheduled-report:run:1");
    expect(init?.body).toBe(
      JSON.stringify({ reply_to: "msg_in", text: "On it." })
    );
  });

  it("sends a sign-in code from the configured number", async () => {
    vi.stubEnv("BLOOIO_FROM_NUMBER", "+15559876543");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendBlooioText } = await import("@shared/blooio/api");

    await sendBlooioText({
      from: "+15559876543",
      idempotencyKey: "otp-1",
      message: "code",
      to: "+15551234567",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        from: "+15559876543",
        text: "code",
        to: "+15551234567",
      })
    );
  });

  it("surfaces Blooio's error message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "channel_number_not_found", message: "No line" },
        }),
        { status: 404 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { BlooioApiError, sendBlooioChatMessage } =
      await import("@shared/blooio/api");
    let failure: InstanceType<typeof BlooioApiError> | undefined;
    try {
      await sendBlooioChatMessage("chat_1", { text: "Hi" });
    } catch (caught) {
      if (caught instanceof BlooioApiError) failure = caught;
    }

    expect(failure?.status).toBe(404);
    expect(failure?.code).toBe("channel_number_not_found");
    expect(failure?.message).toContain("No line");
  });
});

function signedRequest(body: string) {
  return new Request("https://assistant.example/webhooks/blooio", {
    body,
    headers: {
      "x-blooio-signature": blooioSignatureHeader("whsec_test", body),
    },
    method: "POST",
  });
}
