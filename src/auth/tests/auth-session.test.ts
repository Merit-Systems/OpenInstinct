import { beforeEach, describe, expect, it, vi } from "vitest";
import { authSessionDependencies, getAuthSession } from "@/auth/session";
import { authSessionFor } from "@/tests/helpers/auth-session";

const getSessionMock = vi.spyOn(authSessionDependencies, "getSession");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth session", () => {
  it("returns only sessions backed by a verified phone number", async () => {
    const verified = authSessionFor({
      id: "user-1",
      phoneNumber: "+12025550123",
      phoneNumberVerified: true,
    });
    getSessionMock
      .mockResolvedValueOnce(verified)
      .mockResolvedValueOnce(
        authSessionFor({
          id: "user-2",
          phoneNumber: "+12025550124",
          phoneNumberVerified: false,
        })
      )
      .mockResolvedValueOnce(
        authSessionFor({ id: "user-3", phoneNumberVerified: true })
      )
      .mockResolvedValueOnce(
        authSessionFor({
          id: "user-4",
          phoneNumber: "",
          phoneNumberVerified: true,
        })
      );

    const headers = new Headers();
    await expect(getAuthSession(headers)).resolves.toEqual(verified);
    await expect(getAuthSession(headers)).resolves.toBeNull();
    await expect(getAuthSession(headers)).resolves.toBeNull();
    await expect(getAuthSession(headers)).resolves.toBeNull();
  });
});
