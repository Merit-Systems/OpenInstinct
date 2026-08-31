import { getToken } from "@vercel/connect";
import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { phoneOtpErrorMessage } from "../app/sign-in/phone-auth-form";

vi.mock("@vercel/connect", () => ({ getToken: vi.fn<typeof getToken>() }));

const linqApiErrorSchema = z.object({
  code: z.string(),
  linqError: z.object({
    code: z.number(),
    message: z.string(),
    status: z.number(),
    trace_id: z.string(),
  }),
  message: z.string(),
});

describe("Linq phone authentication", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("preserves provider diagnostics and returns actionable client copy", async () => {
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "0123456789abcdefghijklmnopqrstuvwxyzABCD"
    );
    vi.stubEnv("LINQ_CONNECTOR", "linq/open-instinct");
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

    const { sendPhoneCode } = await import("../auth");
    const error: unknown = await sendPhoneCode({
      code: "123456",
      to: "+12025550123",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    if (!(error instanceof APIError)) throw new TypeError("Expected APIError");

    const body = linqApiErrorSchema.parse(error.body);
    expect(body).toMatchObject({
      code: "LINQ_SENDING_LINE_NOT_VERIFIED",
      linqError: {
        code: 2015,
        message: "no eligible sending line available",
        status: 409,
        trace_id: "trace-123",
      },
    });
    expect(phoneOtpErrorMessage(body)).toContain(
      "Phone Numbers verification instruction"
    );
  });
});
