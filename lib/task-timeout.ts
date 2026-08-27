export const browserTaskTimeoutMs = 15 * 60_000;

export function remainingTaskTimeoutMs(
  startedAt: number,
  now = Date.now()
): number {
  return Math.max(0, browserTaskTimeoutMs - Math.max(0, now - startedAt));
}
