import { describe, expect, it } from "vitest";
import { isAgentcashSolanaPrivateKey } from "./agentcash-wallet";

describe("Agentcash wallet validation", () => {
  it("accepts Solana's base58-encoded 64-byte private-key shape", () => {
    expect(isAgentcashSolanaPrivateKey("1".repeat(87))).toBe(true);
    expect(isAgentcashSolanaPrivateKey("z".repeat(88))).toBe(true);
  });

  it("rejects missing, malformed, and placeholder values", () => {
    expect(isAgentcashSolanaPrivateKey(undefined)).toBe(false);
    expect(isAgentcashSolanaPrivateKey("[SENSITIVE]")).toBe(false);
    expect(isAgentcashSolanaPrivateKey("0".repeat(88))).toBe(false);
    expect(isAgentcashSolanaPrivateKey("1".repeat(86))).toBe(false);
  });
});
