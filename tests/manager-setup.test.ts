import { describe, expect, it } from "vitest";
import {
  createManagerSetupUrl,
  isAllowedManagerMutationOrigin,
  isLocalManagerHostname,
  managerMutationSchema,
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
    expect(url.pathname).toBe("/");
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

    expect(url.pathname).toBe("/vault");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      account: "person@example.com",
      kind: "login",
      label: "Personal login",
      setup: "vault",
    });
  });

  it("requires a Kernel API key when saving the browser connection", () => {
    const mutation = {
      action: "connection.create",
      input: {
        account: "",
        endpoint: "",
        label: "Kernel browser",
        provider: "kernel",
        secret: "",
      },
    };

    expect(managerMutationSchema.safeParse(mutation).success).toBe(false);
    expect(
      managerMutationSchema.safeParse({
        ...mutation,
        input: { ...mutation.input, secret: "kernel-key" },
      }).success
    ).toBe(true);
  });

  it("accepts a selected gateway model", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "model.select",
        modelId: "anthropic/claude-sonnet-4.5",
      }).success
    ).toBe(true);
  });

  it("accepts the Portless manager hostname as local", () => {
    expect(isLocalManagerHostname("local-vault-assistant.localhost")).toBe(
      true
    );
    expect(isLocalManagerHostname("manager.example.com")).toBe(false);
  });

  it("accepts writes forwarded through the local HTTPS proxy", () => {
    expect(
      isAllowedManagerMutationOrigin({
        forwardedHost: "local-vault-assistant.localhost",
        forwardedProto: "https",
        host: "127.0.0.1:62650",
        origin: "https://local-vault-assistant.localhost",
        requestUrl: "http://127.0.0.1:62650/api/manager",
      })
    ).toBe(true);
    expect(
      isAllowedManagerMutationOrigin({
        forwardedHost: "local-vault-assistant.localhost",
        forwardedProto: "https",
        host: "127.0.0.1:62650",
        origin: "https://evil.localhost",
        requestUrl: "http://127.0.0.1:62650/api/manager",
      })
    ).toBe(false);
  });
});
