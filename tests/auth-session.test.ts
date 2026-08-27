import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<
    (_input: { headers: Headers }) => Promise<{
      user: {
        id: string;
        phoneNumber?: string | null;
        phoneNumberVerified?: boolean | null;
      };
    } | null>
  >(),
}));

vi.mock("@/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

import { getAuthSession } from "../lib/auth/session";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth session", () => {
  it("returns only sessions backed by a verified phone number", async () => {
    const verified = {
      user: {
        id: "user-1",
        phoneNumber: "+12025550123",
        phoneNumberVerified: true,
      },
    };
    mocks.getSession
      .mockResolvedValueOnce(verified)
      .mockResolvedValueOnce({
        user: {
          id: "user-2",
          phoneNumber: "+12025550124",
          phoneNumberVerified: false,
        },
      })
      .mockResolvedValueOnce({
        user: { id: "user-3", phoneNumberVerified: true },
      });

    const headers = new Headers();
    await expect(getAuthSession(headers)).resolves.toBe(verified);
    await expect(getAuthSession(headers)).resolves.toBeNull();
    await expect(getAuthSession(headers)).resolves.toBeNull();
  });
});
