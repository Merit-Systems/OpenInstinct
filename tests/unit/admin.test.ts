import { describe, expect, it } from "vitest";
import { parseAdminPhoneNumbers } from "@/lib/admin";

describe("admin phone allow-list parsing", () => {
  it("normalizes comma-separated phone numbers", () => {
    expect(parseAdminPhoneNumbers(" +1 (212) 555-0100, 12125550101 ")).toEqual(
      new Set(["+12125550100", "+12125550101"])
    );
  });

  it("returns no administrators for an empty or invalid list", () => {
    expect(parseAdminPhoneNumbers("")).toEqual(new Set());
    expect(parseAdminPhoneNumbers("not-a-phone, 123")).toEqual(new Set());
  });
});
