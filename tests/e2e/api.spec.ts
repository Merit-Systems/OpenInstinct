import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import { z } from "zod";

const mintResponseSchema = z.tuple([
  z.object({
    result: z.object({
      data: z.object({ credential: z.object({}), secret: z.string() }),
    }),
  }),
]);
const agentResponseSchema = z.object({
  data: z.object({ id: z.string(), slug: z.string().optional() }),
});

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
  const minted = mintResponseSchema.parse(await mint.json());
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
  const createdBody = agentResponseSchema.parse(await created.json());
  expect(createdBody).toMatchObject({ data: { slug } });
  const createdId = createdBody.data.id;

  const replay = await page.request.post("/v1/agents", {
    data: { slug },
    headers: { ...authorization, "Idempotency-Key": idempotencyKey },
  });
  await expectStatus(replay, 201, "agents-create-replay");
  const replayBody = agentResponseSchema.parse(await replay.json());
  expect(replayBody.data.id).toBe(createdId);

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
