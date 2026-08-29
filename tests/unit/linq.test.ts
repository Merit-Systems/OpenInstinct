import { getToken } from "@vercel/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LinqDeliveryError,
  linqOtpFailure,
  sendLinqText,
} from "../../auth/linq";

vi.mock("@vercel/connect", () => ({ getToken: vi.fn<typeof getToken>() }));

describe("Linq delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the configured connector and sends the OTP", async () => {
    vi.mocked(getToken).mockResolvedValue("test-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendLinqText({
      connector: "linq/open-instinct",
      idempotencyKey: "otp-idempotency-key",
      message: "Your code is 123456.",
      to: "+12025550123",
    });

    expect(getToken).toHaveBeenCalledWith("linq/open-instinct", {
      subject: { type: "app" },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.linqapp.com/api/partner/v3/messages");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Idempotency-Key": "otp-idempotency-key",
    });
    expect(init?.method).toBe("POST");
  });

  it("preserves Linq error diagnostics", async () => {
    vi.mocked(getToken).mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code: 2015,
            message: "no eligible sending line available",
            trace_id: "trace-123",
          },
          { status: 409 }
        )
      )
    );

    const error: unknown = await sendLinqText({
      connector: "linq/open-instinct",
      idempotencyKey: "otp-idempotency-key",
      message: "Your code is 123456.",
      to: "+12025550123",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LinqDeliveryError);
    if (!(error instanceof LinqDeliveryError)) {
      throw new TypeError("Expected LinqDeliveryError");
    }
    expect(error).toMatchObject({
      code: 2015,
      linqMessage: "no eligible sending line available",
      status: 409,
      traceId: "trace-123",
    });
    expect(error.message).toContain("trace_id trace-123");
  });

  it.each([
    [2015, "LINQ_CONTACT_NOT_ALLOWED", "Messaging Contacts"],
    [2024, "LINQ_RECIPIENT_OPTED_OUT", "opted out"],
    [2027, "LINQ_REPUTATION_BLOCKED", "messaging reputation"],
  ])("maps Linq code %i to actionable OTP copy", (code, expectedCode, copy) => {
    const failure = linqOtpFailure(
      new LinqDeliveryError({ code, status: 409 })
    );

    expect(failure.code).toBe(expectedCode);
    expect(failure.message).toContain(copy);
  });
});
