import { describe, expect, it } from "vitest";
import {
  emptyUserProfile,
  hasUserProfileValues,
  parseUserProfile,
  userProfilePatchSchema,
} from "@/lib/user-profile";

describe("user profile", () => {
  it("validates and normalizes form-ready personal information", () => {
    expect(
      parseUserProfile({
        ...emptyUserProfile,
        countryCode: "us",
        dateOfBirth: "1990-01-02",
        email: "person@example.com",
      })
    ).toEqual({
      ...emptyUserProfile,
      countryCode: "US",
      dateOfBirth: "1990-01-02",
      email: "person@example.com",
    });
  });

  it("supports explicit field removal without accepting empty updates", () => {
    expect(userProfilePatchSchema.parse({ phone: null })).toEqual({
      phone: null,
    });
    expect(userProfilePatchSchema.safeParse({}).success).toBe(false);
    expect(hasUserProfileValues(emptyUserProfile)).toBe(false);
    expect(
      hasUserProfileValues({ ...emptyUserProfile, city: "Brooklyn" })
    ).toBe(true);
  });
});
