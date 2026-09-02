const solanaPrivateKeyPattern = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/u;

export function isAgentcashSolanaPrivateKey(value: string | undefined) {
  return value !== undefined && solanaPrivateKeyPattern.test(value);
}
