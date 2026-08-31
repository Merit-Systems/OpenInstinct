import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PhoneAuthForm,
  phoneOtpErrorMessage,
} from "@/app/sign-in/phone-auth-form";

describe("phone OTP errors", () => {
  it("shows actionable Linq errors", () => {
    expect(
      phoneOtpErrorMessage({
        code: "LINQ_RECIPIENT_NOT_VERIFIED",
        message: "Send a message to the Linq phone number, then try again.",
      })
    ).toBe("Send a message to the Linq phone number, then try again.");
  });

  it("does not expose unrelated server errors", () => {
    expect(
      phoneOtpErrorMessage({
        code: "INTERNAL_SERVER_ERROR",
        message: "database connection string",
      })
    ).toBe("Unable to send a code. Please try again.");
  });

  it("explains setup instead of offering a broken production sign-in form", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneAuthForm, {
        callbackUrl: "/",
        linqConfigured: false,
        skipOtp: false,
      })
    );

    expect(html).toContain("iMessage sign-in is not configured");
    expect(html).toContain("Vercel Connect");
    expect(html).not.toContain('type="tel"');
  });

  it("explains and links the required first-time Messages flow", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneAuthForm, {
        callbackUrl: "/",
        linqConfigured: true,
        linqPhoneNumber: "+12025550123",
        skipOtp: false,
      })
    );

    expect(html).toContain("First time signing in?");
    expect(html).toContain("Linq requires one message");
    expect(html).toContain("Send any message");
    expect(html).toContain("Return here and select Send code");
    expect(html).toContain('href="sms:+12025550123"');
    expect(html).toContain("Text Linq in Messages");
  });

  it("keeps the required flow visible when the number cannot be resolved", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneAuthForm, {
        callbackUrl: "/",
        linqConfigured: true,
        linqPhoneNumber: undefined,
        skipOtp: false,
      })
    );

    expect(html).toContain("First time signing in?");
    expect(html).toContain("Find the Linq number in Vercel Connect");
    expect(html).not.toContain("sms:");
    const error = phoneOtpErrorMessage({
      code: "LINQ_SENDING_LINE_UNAVAILABLE",
      message:
        "No Linq line is currently eligible. Complete the first-time sign-in steps above or review line health in Linq.",
    });
    expect(error).toContain("first-time sign-in steps above");
    expect(error).not.toContain("button");
  });

  it("does not show Linq setup during local sign-in", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneAuthForm, {
        callbackUrl: "/",
        linqConfigured: false,
        linqPhoneNumber: undefined,
        skipOtp: true,
      })
    );

    expect(html).not.toContain("First time signing in?");
    expect(html).toContain("Continue locally");
  });
});
