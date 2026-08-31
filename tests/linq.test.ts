import { getToken } from "@vercel/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinqDeliveryError, linqOtpFailure, sendLinqText } from "../auth/linq";

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

  it("preserves diagnostics from Linq's current error envelope", async () => {
    vi.mocked(getToken).mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 2015,
              message: "no eligible sending line available",
              status: 409,
            },
            success: false,
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

  it("preserves diagnostics from Linq's legacy error envelope", async () => {
    vi.mocked(getToken).mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code: 2024,
            message: "Recipient opted out",
            trace_id: "legacy-trace",
          },
          { status: 403 }
        )
      )
    );

    const error: unknown = await sendLinqText({
      connector: "linq/open-instinct",
      idempotencyKey: "otp-idempotency-key",
      message: "Your code is 123456.",
      to: "+12025550123",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 2024,
      linqMessage: "Recipient opted out",
      status: 403,
      traceId: "legacy-trace",
    });
  });

  it("falls back to Linq's trace response header", async () => {
    vi.mocked(getToken).mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: { code: 2008, message: "Recipient not allowed" },
            success: false,
          },
          { headers: { "x-trace-id": "trace-header" }, status: 403 }
        )
      )
    );

    const error: unknown = await sendLinqText({
      connector: "linq/open-instinct",
      idempotencyKey: "otp-idempotency-key",
      message: "Your code is 123456.",
      to: "+12025550123",
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 2008,
      linqMessage: "Recipient not allowed",
      status: 403,
      traceId: "trace-header",
    });
  });

  it.each([
    [2008, "LINQ_RECIPIENT_NOT_VERIFIED", "message your deployment"],
    [2024, "LINQ_RECIPIENT_OPTED_OUT", "opted out"],
    [2027, "LINQ_REPUTATION_BLOCKED", "messaging reputation"],
  ])("maps Linq code %i to actionable OTP copy", (code, expectedCode, copy) => {
    const failure = linqOtpFailure(
      new LinqDeliveryError({ code, status: 409 })
    );

    expect(failure.code).toBe(expectedCode);
    expect(failure.message).toContain(copy);
  });

  it("explains how to verify a newly provisioned sending line", () => {
    const failure = linqOtpFailure(
      new LinqDeliveryError({
        code: 2015,
        linqMessage: "no eligible sending line available",
        status: 409,
      })
    );

    expect(failure.code).toBe("LINQ_SENDING_LINE_NOT_VERIFIED");
    expect(failure.message).toContain("Phone Numbers verification instruction");
  });

  it("does not mislabel unrelated Linq conflicts as verification failures", () => {
    const failure = linqOtpFailure(
      new LinqDeliveryError({
        code: 2015,
        linqMessage: "Operation conflicts with current state",
        status: 409,
      })
    );

    expect(failure.code).toBe("LINQ_DELIVERY_FAILED");
  });
});
