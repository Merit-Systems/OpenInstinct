import { describe, expect, it } from "vitest";
import {
  squareBaseUrl,
  squareScopes,
  squareSubject,
  squareTokenParams,
} from "@/lib/square";

describe("square", () => {
  it("builds a per-user Vercel Connect subject", () => {
    expect(squareSubject("u1")).toEqual({
      id: "u1",
      issuer: "openinstinct",
      type: "user",
    });
  });

  it("requests every read scope and no write scope", () => {
    const params = squareTokenParams("u1");

    expect(params.scopes).toEqual([...squareScopes]);
    expect(params.scopes?.some((scope) => scope.endsWith("_WRITE"))).toBe(
      false
    );
    expect(params.subject).toEqual(squareSubject("u1"));
  });

  it("resolves the sandbox and production base URLs", () => {
    expect(squareBaseUrl("sandbox")).toBe(
      "https://connect.squareupsandbox.com"
    );
    expect(squareBaseUrl("production")).toBe("https://connect.squareup.com");
  });
});
