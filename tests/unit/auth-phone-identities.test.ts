import { describe, expect, it, vi } from "vitest";
import { createPhoneNumberOptions } from "@/auth";

const phoneNumber = "+12025550123";

function optionsFor({
  localPhoneAuthBypassEnabled = false,
  recordVerifiedPhoneIdentity = vi.fn<
    (input: {
      readonly phoneNumber: string;
      readonly userId: string;
    }) => Promise<void>
  >(),
  sendPhoneCode = vi.fn<
    (input: { readonly code: string; readonly to: string }) => Promise<void>
  >(),
} = {}) {
  const options = createPhoneNumberOptions({
    localPhoneAuthBypassEnabled,
    recordVerifiedPhoneIdentity,
    sendPhoneCode,
  });
  if (!options) throw new Error("Phone number plugin options are required.");
  return {
    options,
    recordVerifiedPhoneIdentity,
    sendPhoneCode,
  };
}

describe("phone identity verification wiring", () => {
  it("records identities after real OTP verification", async () => {
    const { options, recordVerifiedPhoneIdentity } = optionsFor();

    expect(options.verifyOTP).toBeUndefined();
    await options.callbackOnVerification?.({
      phoneNumber,
      user: verifiedUser(),
    });
    expect(recordVerifiedPhoneIdentity).toHaveBeenCalledWith({
      phoneNumber,
      userId: "alice",
    });
  });

  it("records identities after bypass OTP verification", async () => {
    const { options, recordVerifiedPhoneIdentity } = optionsFor({
      localPhoneAuthBypassEnabled: true,
    });

    expect(await options.verifyOTP?.({ code: "123456", phoneNumber })).toBe(
      true
    );
    await options.callbackOnVerification?.({
      phoneNumber,
      user: verifiedUser(),
    });
    expect(recordVerifiedPhoneIdentity).toHaveBeenCalledWith({
      phoneNumber,
      userId: "alice",
    });
  });

  it("does not reject verification when identity recording fails", async () => {
    const storageError = new Error("storage unavailable");
    storageError.name = "IdentityStoreError";
    const recordVerifiedPhoneIdentity = vi
      .fn<
        (input: {
          readonly phoneNumber: string;
          readonly userId: string;
        }) => Promise<void>
      >()
      .mockRejectedValue(storageError);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { options } = optionsFor({ recordVerifiedPhoneIdentity });

    await options.callbackOnVerification?.({
      phoneNumber,
      user: verifiedUser(),
    });

    expect(error).toHaveBeenCalledWith(
      "Failed to record verified phone identity.",
      "IdentityStoreError"
    );
  });
});

function verifiedUser() {
  const now = new Date("2026-08-31T00:00:00.000Z");
  return {
    createdAt: now,
    email: "alice@example.test",
    emailVerified: true,
    id: "alice",
    image: null,
    name: "Alice",
    phoneNumber,
    phoneNumberVerified: true,
    updatedAt: now,
  };
}
