/* oxlint-disable vitest/require-mock-type-parameters -- The hoisted Kernel fake records cleanup request options. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ playwrightExecute: vi.fn() }));

vi.mock("@/lib/kernel", () => ({
  kernel: { browsers: { playwright: { execute: mocks.playwrightExecute } } },
}));

import {
  withVaultBrowserObservationMask,
  withVaultScreenshotMask,
} from "../agent/subagents/worker/lib/vault-screenshot-mask";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Vault screenshot masking", () => {
  it("removes the mask with a fresh request after capture cancellation", async () => {
    const controller = new AbortController();
    mocks.playwrightExecute.mockResolvedValue({ success: true });

    await expect(
      withVaultScreenshotMask("browser-1", controller.signal, async () => {
        controller.abort();
        throw new Error("Capture cancelled");
      })
    ).rejects.toThrow("Capture cancelled");

    expect(mocks.playwrightExecute).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify(mocks.playwrightExecute.mock.calls[0]?.[1])
    ).toContain("append(style)");
    expect(mocks.playwrightExecute.mock.calls[0]?.[2]).toEqual({
      signal: controller.signal,
    });
    expect(
      JSON.stringify(mocks.playwrightExecute.mock.calls[1]?.[1])
    ).toContain("remove()");
    expect(mocks.playwrightExecute.mock.calls[1]?.[2]).toEqual({
      signal: undefined,
    });
  });

  it("keeps the shared mask until every overlapping capture completes", async () => {
    mocks.playwrightExecute.mockResolvedValue({ success: true });
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = withVaultScreenshotMask(
      "browser-1",
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    );
    await vi.waitFor(() => {
      expect(mocks.playwrightExecute).toHaveBeenCalledTimes(1);
      expect(finishFirst).toBeTypeOf("function");
    });
    const second = withVaultScreenshotMask(
      "browser-1",
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        })
    );
    await vi.waitFor(() => {
      expect(mocks.playwrightExecute).toHaveBeenCalledTimes(2);
      expect(finishSecond).toBeTypeOf("function");
    });

    finishFirst?.();
    await first;
    expect(mocks.playwrightExecute).toHaveBeenCalledTimes(3);

    finishSecond?.();
    await second;
    expect(mocks.playwrightExecute).toHaveBeenCalledTimes(4);
    expect(
      JSON.stringify(mocks.playwrightExecute.mock.calls[0]?.[1])
    ).toContain("append(style)");
    expect(
      JSON.stringify(mocks.playwrightExecute.mock.calls[2]?.[1])
    ).toContain("remainingRefs");
    expect(JSON.stringify(mocks.playwrightExecute.mock.calls)).toContain(
      "vaultMaskRefs"
    );
  });

  it("repairs an abandoned accessibility mask on the next observation", async () => {
    mocks.playwrightExecute
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    await expect(
      withVaultBrowserObservationMask("browser-1", undefined, async () => true)
    ).resolves.toBe(true);
    await expect(
      withVaultBrowserObservationMask("browser-1", undefined, async () => true)
    ).resolves.toBe(true);

    expect(mocks.playwrightExecute).toHaveBeenCalledTimes(4);
    const recoveryAdd = JSON.stringify(
      mocks.playwrightExecute.mock.calls[2]?.[1]
    );
    expect(recoveryAdd).toContain("stalePrevious");
    expect(recoveryAdd).toContain("removeAttribute");
    expect(recoveryAdd).toContain(
      'setAttribute(\\"aria-hidden\\", \\"true\\")'
    );
  });
});
