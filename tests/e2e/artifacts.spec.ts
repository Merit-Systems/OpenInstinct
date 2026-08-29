import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("keeps missing artifacts private", async ({ browser, page }) => {
  const artifactPath = `/artifacts/${randomUUID()}`;
  const authenticated = await page.goto(artifactPath);
  expect(authenticated?.status()).toBe(404);
  expect(authenticated?.headers()["content-security-policy"]).toBe(
    "default-src 'none'; sandbox"
  );
  expect(authenticated?.headers()["x-content-type-options"]).toBe("nosniff");

  const anonymousContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(artifactPath);
  await expect(anonymousPage).toHaveURL(
    `/sign-in?callbackUrl=${encodeURIComponent(artifactPath)}`
  );
  await anonymousContext.close();
});
