import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PhoneAuthForm,
  phoneOtpErrorMessage,
} from "../app/sign-in/phone-auth-form";

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
});
