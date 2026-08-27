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
        code: "LINQ_CONTACT_NOT_ALLOWED",
        message: "Add this phone number to Messaging Contacts.",
      })
    ).toBe("Add this phone number to Messaging Contacts.");
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
    expect(html).toContain("LINQ_CONNECTOR and LINQ_PHONE_NUMBER");
    expect(html).not.toContain('type="tel"');
  });
});
