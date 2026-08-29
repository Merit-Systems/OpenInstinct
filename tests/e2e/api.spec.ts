import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";

interface MintPayload {
  readonly credential: Record<string, unknown>;
  readonly secret: string;
}

type TrpcBatchResponse = readonly [
  { readonly result: { readonly data: MintPayload } },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMintResponse(value: unknown): value is TrpcBatchResponse {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const entries: readonly unknown[] = value;
  const entry = entries[0];
  if (
    !isRecord(entry) ||
    !isRecord(entry.result) ||
    !isRecord(entry.result.data)
  )
    return false;
  return (
    typeof entry.result.data.secret === "string" &&
    isRecord(entry.result.data.credential)
  );
}

function agentIdFromResponse(value: unknown): string {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    typeof value.data.id !== "string"
  )
    throw new Error(`Unexpected agent response: ${JSON.stringify(value)}`);
  return value.data.id;
}

async function expectStatus(
  response: APIResponse,
  expectedStatus: number,
  requestName: string
) {
  if (response.status() === expectedStatus) return;

  const body = await response.text();
  await test.info().attach(`${requestName}-response.txt`, {
    body,
    contentType: "text/plain",
  });
  expect(response.status(), `${requestName} response:\n${body}`).toBe(
    expectedStatus
  );
}

test("mints a credential and uses the versioned agents API", async ({
  page,
}) => {
  const mint = await page.request.post(
    "/api/trpc/apiCredentials.mint?batch=1",
    {
      data: {
        0: {
          name: `e2e-${randomUUID()}`,
          scopes: ["agents:read", "agents:write"],
        },
      },
    }
  );
  await expectStatus(mint, 200, "api-credentials-mint");
  const minted: unknown = await mint.json();
  if (!isMintResponse(minted)) {
    throw new Error(`Unexpected mint response: ${JSON.stringify(minted)}`);
  }
  const secret = minted[0].result.data.secret;
  expect(secret).toMatch(/^oi_/);

  const authorization = { Authorization: `Bearer ${secret}` };
  const before = await page.request.get("/v1/agents", {
    headers: authorization,
  });
  await expectStatus(before, 200, "agents-list-before-create");
  expect(await before.json()).toMatchObject({ data: expect.any(Array) });

  const slug = `e2e-${randomUUID()}`;
  const missingIdempotencyKey = await page.request.post("/v1/agents", {
    data: { slug },
    headers: authorization,
  });
  await expectStatus(
    missingIdempotencyKey,
    400,
    "agents-create-missing-idempotency-key"
  );
  expect(await missingIdempotencyKey.json()).toMatchObject({
    error: { code: "idempotency_key_required" },
  });

  const idempotencyKey = randomUUID();
  const created = await page.request.post("/v1/agents", {
    data: { slug },
    headers: { ...authorization, "Idempotency-Key": idempotencyKey },
  });
  await expectStatus(created, 201, "agents-create");
  const createdBody: unknown = await created.json();
  expect(createdBody).toMatchObject({ data: { slug } });
  const createdId = agentIdFromResponse(createdBody);

  const replay = await page.request.post("/v1/agents", {
    data: { slug },
    headers: { ...authorization, "Idempotency-Key": idempotencyKey },
  });
  await expectStatus(replay, 201, "agents-create-replay");
  const replayBody: unknown = await replay.json();
  expect(agentIdFromResponse(replayBody)).toBe(createdId);

  const after = await page.request.get("/v1/agents", {
    headers: authorization,
  });
  await expectStatus(after, 200, "agents-list-after-create");
  expect(await after.json()).toMatchObject(
    expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ slug })]),
    })
  );

  const unauthorized = await page.request.get("/v1/agents", {
    headers: { Authorization: "Bearer oi_not_a_real_key" },
  });
  await expectStatus(unauthorized, 401, "agents-list-bogus-key");
});
