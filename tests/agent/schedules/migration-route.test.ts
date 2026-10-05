import type { authorizeScheduledBackfillRequest } from "@db/services/auth/scheduled-requests";
import type { start } from "workflow/api";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn<typeof authorizeScheduledBackfillRequest>(),
  start: vi
    .fn<
      (
        ...args: Parameters<typeof start>
      ) => Promise<Pick<Awaited<ReturnType<typeof start>>, "returnValue">>
    >()
    .mockResolvedValue({
      returnValue: Promise.resolve({ wakeups: [], result: {} }),
    }),
}));
vi.mock("@db/services/auth/scheduled-requests", () => ({
  authorizeScheduledBackfillRequest: mocks.authorize,
}));
vi.mock("@shared/environment/scheduled-origin", () => ({
  scheduledWakeupOrigin: async () => "https://example.com",
}));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@app/api/scheduled-wakeups/workflows", () => ({
  scheduledCommandWorkflow: vi.fn<typeof scheduledCommandWorkflow>(),
}));

import { POST } from "@app/api/scheduled-wakeups/migrate/route";
import { scheduledCommandWorkflow } from "@app/api/scheduled-wakeups/workflows";

beforeEach(() => vi.clearAllMocks());

it("limits migration credentials to a fixed backfill even with a mutation body", async () => {
  mocks.authorize.mockResolvedValue(undefined);
  const response = await POST(
    new Request("https://example.com/api/scheduled-wakeups/migrate", {
      method: "POST",
      body: JSON.stringify({
        kind: "create",
        input: { prompt: "Arbitrary mutation." },
      }),
    })
  );
  expect(response.status).toBe(200);
  expect(mocks.start).toHaveBeenCalledWith(scheduledCommandWorkflow, [
    { kind: "backfill" },
    "https://example.com",
  ]);
});

it("does not start migration when project authorization fails", async () => {
  mocks.authorize.mockResolvedValue(new Response(null, { status: 401 }));
  expect(
    (
      await POST(
        new Request("https://example.com/api/scheduled-wakeups/migrate", {
          method: "POST",
        })
      )
    ).status
  ).toBe(401);
  expect(mocks.start).not.toHaveBeenCalled();
});
