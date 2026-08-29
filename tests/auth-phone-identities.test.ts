import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  interface PhoneOptions {
    callbackOnVerification?: (input: {
      phoneNumber: string;
      user: { id: string };
    }) => Promise<void>;
    verifyOTP?: (input: { phoneNumber: string }) => boolean | Promise<boolean>;
  }

  return {
    localBypassEnabled: false,
    phoneNumber: vi.fn<(options: PhoneOptions) => PhoneOptions>(
      (options) => options
    ),
    recordVerifiedPhoneIdentity:
      vi.fn<
        (input: { phoneNumber: string; userId: string }) => Promise<void>
      >(),
  };
});

vi.mock("better-auth", () => ({ betterAuth: (options: object) => options }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("better-auth/plugins/phone-number", () => ({
  phoneNumber: mocks.phoneNumber,
}));
vi.mock("@/db", () => ({
  account: {},
  db: {},
  session: {},
  user: {},
  verification: {},
}));
vi.mock("@/db/services/phone-identities", () => ({
  recordVerifiedPhoneIdentity: mocks.recordVerifiedPhoneIdentity,
}));
vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_SECRET: "test-auth-secret",
    BETTER_AUTH_URL: "https://example.com",
  },
  get localPhoneAuthBypassEnabled() {
    return mocks.localBypassEnabled;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.localBypassEnabled = false;
});

describe("phone identity verification wiring", () => {
  it("records identities after real OTP verification", async () => {
    mocks.recordVerifiedPhoneIdentity.mockResolvedValue(undefined);
    const options = await phonePluginOptions();

    expect(options.verifyOTP).toBeUndefined();
    await verifyWithCallback(options);
    expect(mocks.recordVerifiedPhoneIdentity).toHaveBeenCalledWith({
      phoneNumber,
      userId: "alice",
    });
  });

  it("records identities after bypass OTP verification", async () => {
    mocks.localBypassEnabled = true;
    mocks.recordVerifiedPhoneIdentity.mockResolvedValue(undefined);
    const options = await phonePluginOptions();

    expect(await options.verifyOTP?.({ phoneNumber })).toBe(true);
    await verifyWithCallback(options);
    expect(mocks.recordVerifiedPhoneIdentity).toHaveBeenCalledWith({
      phoneNumber,
      userId: "alice",
    });
  });

  it("does not reject verification when identity recording fails", async () => {
    const storageError = new Error("storage unavailable");
    storageError.name = "IdentityStoreError";
    mocks.recordVerifiedPhoneIdentity.mockRejectedValue(storageError);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const options = await phonePluginOptions();

    await verifyWithCallback(options);
    expect(error).toHaveBeenCalledWith(
      "Failed to record verified phone identity.",
      "IdentityStoreError"
    );
    const logged = error.mock.calls[0]?.map(String).join(" ");
    expect(logged).not.toMatch(/\d/);
  });
});

const phoneNumber = "+12025550123";

async function phonePluginOptions() {
  await import("@/auth");
  const options = mocks.phoneNumber.mock.calls.at(-1)?.[0];
  if (!options) throw new Error("Expected phone number plugin options.");
  return options;
}

async function verifyWithCallback(options: {
  callbackOnVerification?: (input: {
    phoneNumber: string;
    user: { id: string };
  }) => Promise<void>;
}) {
  if (!options.callbackOnVerification) {
    throw new Error("Expected a verification callback.");
  }
  await expect(
    options.callbackOnVerification({ phoneNumber, user: { id: "alice" } })
  ).resolves.toBeUndefined();
}
