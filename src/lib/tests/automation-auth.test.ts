import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAutomationRequestHeaders,
  verifyAutomationRequest,
} from "../automation-auth";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("automation request authentication", () => {
  it("accepts an intact purpose-bound signature and rejects tampering", async () => {
    const headers = new Headers(
      await createAutomationRequestHeaders({
        automationId: "automation-1",
        purpose: "arm",
        revision: 3,
      })
    );
    await expect(
      verifyAutomationRequest(headers, "arm")
    ).resolves.toMatchObject({
      automationId: "automation-1",
      purpose: "arm",
      revision: 3,
    });
    await expect(
      verifyAutomationRequest(headers, "execute")
    ).resolves.toBeUndefined();

    headers.set("x-openinstinct-automation-revision", "4");
    await expect(
      verifyAutomationRequest(headers, "arm")
    ).resolves.toBeUndefined();
  });

  it("expires captured signatures", async () => {
    const timestamp = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(timestamp);
    const headers = new Headers(
      await createAutomationRequestHeaders({
        automationId: "automation-1",
        purpose: "execute",
        revision: 1,
        runId: "run-1",
      })
    );
    now.mockReturnValue(timestamp + 6 * 60 * 1000);
    await expect(
      verifyAutomationRequest(headers, "execute")
    ).resolves.toBeUndefined();
  });
});
