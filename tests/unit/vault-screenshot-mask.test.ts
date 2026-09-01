/* oxlint-disable vitest/require-mock-type-parameters -- The hoisted Kernel fake records cleanup request options. */
import { describe, expect, it, vi } from "vitest";
import { withVaultScreenshotMask } from "../../agent/subagents/worker/lib/vault-screenshot-mask";

const playwrightExecuteMock =
  vi.fn<
    (
      sessionId: string,
      body: { readonly code: string; readonly timeout_sec: number },
      options: { readonly signal?: AbortSignal }
    ) => Promise<{ readonly success: boolean }>
  >();
const dependencies = { execute: playwrightExecuteMock };

describe("Vault screenshot masking", () => {
  it("removes the mask with a fresh request after capture cancellation", async () => {
    const controller = new AbortController();
    playwrightExecuteMock.mockResolvedValue({ success: true });

    await expect(
      withVaultScreenshotMask(
        "browser-1",
        controller.signal,
        async () => {
          controller.abort();
          throw new Error("Capture cancelled");
        },
        dependencies
      )
    ).rejects.toThrow("Capture cancelled");

    expect(playwrightExecuteMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(playwrightExecuteMock.mock.calls[0]?.[1])).toContain(
      "append(style)"
    );
    expect(playwrightExecuteMock.mock.calls[0]?.[2]).toEqual({
      signal: controller.signal,
    });
    expect(JSON.stringify(playwrightExecuteMock.mock.calls[1]?.[1])).toContain(
      "remove()"
    );
    expect(playwrightExecuteMock.mock.calls[1]?.[2]).toEqual({
      signal: undefined,
    });
  });

  it("keeps the shared mask until every overlapping capture completes", async () => {
    let maskReferences = 0;
    playwrightExecuteMock.mockImplementation(
      async (_sessionId: string, body: { code: string }) => {
        maskReferences += body.code.includes("remainingRefs") ? -1 : 1;
        return { success: true };
      }
    );
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = withVaultScreenshotMask(
      "browser-1",
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
      dependencies
    );
    await vi.waitFor(() => {
      expect(maskReferences).toBe(1);
    });
    const second = withVaultScreenshotMask(
      "browser-1",
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
      dependencies
    );
    await vi.waitFor(() => {
      expect(maskReferences).toBe(2);
    });

    finishFirst?.();
    await first;
    expect(maskReferences).toBe(1);

    finishSecond?.();
    await second;
    expect(maskReferences).toBe(0);
    expect(JSON.stringify(playwrightExecuteMock.mock.calls)).toContain(
      "vaultMaskRefs"
    );
  });
});
