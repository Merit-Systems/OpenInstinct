/* oxlint-disable vitest/require-mock-type-parameters -- Hoisted Blob fakes are configured per test. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ get: mocks.get, put: mocks.put }));

import { executeAgentcashPayment } from "./agentcash-operation-store";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const toolInput = { maxAmount: 0.25, url: "https://example.com/data" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(undefined);
  mocks.put.mockResolvedValue({ pathname: "agentcash-operation" });
});

describe("Agentcash payment receipts", () => {
  it("replays a successful result without paying twice", async () => {
    const operation = vi.fn(async () => ({ answer: 42 }));
    const first = await executeAgentcashPayment({
      callId: "call-1",
      operation,
      scope,
      toolInput,
    });

    expect(first).toEqual({ answer: 42 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ allowOverwrite: false })
    );
    const successfulReceipt = String(mocks.put.mock.calls[1]?.[1]);
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(successfulReceipt).body,
    });

    const replay = await executeAgentcashPayment({
      callId: "call-1",
      operation,
      scope,
      toolInput,
    });

    expect(replay).toEqual({ answer: 42 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("blocks a retry after an ambiguous paid call", async () => {
    const operation = vi.fn(async () => {
      throw new Error("connection closed after payment");
    });
    await expect(
      executeAgentcashPayment({
        callId: "call-2",
        operation,
        scope,
        toolInput,
      })
    ).rejects.toThrow("connection closed after payment");

    const uncertainReceipt = String(mocks.put.mock.calls[1]?.[1]);
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(uncertainReceipt).body,
    });
    await expect(
      executeAgentcashPayment({
        callId: "call-2",
        operation,
        scope,
        toolInput,
      })
    ).rejects.toThrow(/already attempted/u);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("returns a paid result when only success-receipt persistence fails", async () => {
    mocks.put
      .mockResolvedValueOnce({ pathname: "agentcash-operation" })
      .mockRejectedValueOnce(new Error("blob unavailable"));
    const operation = vi.fn(async () => ({ answer: 42 }));

    await expect(
      executeAgentcashPayment({
        callId: "call-3",
        operation,
        scope,
        toolInput,
      })
    ).resolves.toEqual({ answer: 42 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledTimes(2);
  });
});
