import { describe, expect, it } from "vitest";
import {
  agentcashFetchSchema,
  enforceAgentcashFetch,
  safeAgentcashReadInput,
} from "./agentcash-policy";

describe("Agentcash payment policy", () => {
  it("requires HTTPS and a caller-visible payment ceiling", () => {
    expect(() =>
      agentcashFetchSchema.parse({
        maxAmount: 1,
        url: "http://example.com/api",
      })
    ).toThrow(/HTTPS/u);
    expect(() =>
      agentcashFetchSchema.parse({ url: "https://example.com/api" })
    ).toThrow();
  });

  it("enforces the deployment ceiling and removes no payment detail", () => {
    const input = agentcashFetchSchema.parse({
      body: { query: "test" },
      maxAmount: 0.25,
      method: "POST",
      paymentProtocol: "x402",
      url: "https://example.com/api",
    });
    expect(enforceAgentcashFetch(input, 0.5)).toMatchObject({
      maxAmount: 0.25,
      paymentProtocol: "x402",
    });
    expect(() => enforceAgentcashFetch(input, 0.1)).toThrow(
      /deployment limit/u
    );
  });

  it("rejects credential-bearing headers in paid and discovery calls", () => {
    expect(() =>
      agentcashFetchSchema.parse({
        headers: { Authorization: "Bearer secret" },
        maxAmount: 1,
        url: "https://example.com/api",
      })
    ).toThrow(/credential headers/u);
    expect(() =>
      safeAgentcashReadInput("check_endpoint_schema", {
        headers: { Cookie: "session=secret" },
        url: "https://example.com/api",
      })
    ).toThrow(/credential headers/u);
  });
});
