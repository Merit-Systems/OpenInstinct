import { describe, expect, it } from "vitest";
import { agentcashApprovalResponderAllowed } from "./agentcash-access";
import {
  agentcashFetchSchema,
  agentcashNoPaymentCeilingUsd,
  assertAgentcashFreeSiwxEndpoint,
  enforceAgentcashFetch,
  safeAgentcashReadInput,
} from "./agentcash-policy";

describe("Agentcash payment policy", () => {
  it("accepts payment approval only from the allowlisted request owner", () => {
    const allowed = new Set(["user-1", "user-2"]);
    expect(
      agentcashApprovalResponderAllowed(
        { principalId: "user-1", principalType: "user" },
        { principalId: "user-1", principalType: "user" },
        allowed
      )
    ).toBe(true);
    expect(
      agentcashApprovalResponderAllowed(
        { principalId: "user-2", principalType: "user" },
        { principalId: "user-1", principalType: "user" },
        allowed
      )
    ).toBe(false);
  });

  it("requires HTTPS and a caller-visible payment ceiling", () => {
    expect(() =>
      agentcashFetchSchema.parse({
        maxAmount: 1,
        url: "http://example.com/api",
      })
    ).toThrow(/HTTPS/u);
    expect(() =>
      agentcashFetchSchema.parse({ url: "https://example.com/api" })
    ).toThrow(/Invalid input/u);
    for (const url of [
      "https://localhost/api",
      "https://127.0.0.1/api",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/api",
      "https://service.internal/api",
    ]) {
      expect(() => agentcashFetchSchema.parse({ maxAmount: 1, url })).toThrow(
        /public internet host/u
      );
    }
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

  it("allows only confirmed free SIWX requests through the approval-free path", () => {
    const inspection = {
      results: [
        {
          authMode: "siwx",
          method: "GET",
          requiresPayment: false,
        },
      ],
      url: "https://example.com/status/1",
    };

    expect(() => {
      assertAgentcashFreeSiwxEndpoint(
        inspection,
        "https://example.com/status/1"
      );
    }).not.toThrow();
    expect(() => {
      assertAgentcashFreeSiwxEndpoint(
        {
          results: [
            {
              authMode: "paid",
              method: "GET",
              requiresPayment: true,
            },
          ],
          url: "https://example.com/status/1",
        },
        "https://example.com/status/1"
      );
    }).toThrow(/not confirmed as a free SIWX endpoint/u);
    expect(() => {
      assertAgentcashFreeSiwxEndpoint(
        {
          results: [
            {
              authMode: "siwx",
              method: "POST",
              requiresPayment: false,
            },
          ],
          url: "https://example.com/status/1",
        },
        "https://example.com/status/1"
      );
    }).toThrow(/not confirmed as a free SIWX endpoint/u);
    expect(() => {
      assertAgentcashFreeSiwxEndpoint(
        inspection,
        "https://example.com/status/2"
      );
    }).toThrow(/not confirmed as a free SIWX endpoint/u);
  });

  it("uses a positive ceiling below any payable USD amount", () => {
    expect(agentcashNoPaymentCeilingUsd).toBeGreaterThan(0);
    expect(agentcashNoPaymentCeilingUsd).toBeLessThan(0.000001);
  });
});
