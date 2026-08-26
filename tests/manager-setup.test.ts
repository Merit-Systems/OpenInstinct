import { describe, expect, it } from "vitest";
import {
  createManagerSetupUrl,
  managerSetupRequestSchema,
} from "../lib/manager";

describe("local manager setup links", () => {
  it("builds a connection form URL from safe prefill fields", () => {
    const url = new URL(
      createManagerSetupUrl("http://localhost:3000", {
        account: "qwen3.5:27b",
        endpoint: "http://127.0.0.1:11434/v1",
        label: "Ollama",
        provider: "local-model",
        target: "connection",
      })
    );

    expect(url.origin).toBe("http://localhost:3000");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      account: "qwen3.5:27b",
      endpoint: "http://127.0.0.1:11434/v1",
      label: "Ollama",
      provider: "local-model",
      setup: "connection",
    });
  });

  it("builds a vault form URL without accepting a secret", () => {
    expect(
      managerSetupRequestSchema.safeParse({
        kind: "login",
        secret: "must-not-enter-a-url",
        target: "vault",
      }).success
    ).toBe(false);

    const url = new URL(
      createManagerSetupUrl("http://localhost:3000", {
        account: "person@example.com",
        kind: "login",
        label: "Personal login",
        target: "vault",
      })
    );

    expect(Object.fromEntries(url.searchParams)).toEqual({
      account: "person@example.com",
      kind: "login",
      label: "Personal login",
      setup: "vault",
    });
  });
});
