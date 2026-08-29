import { expect, test } from "@playwright/test";
import { signInThroughBypass } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("redirects, signs in through the bypass, and signs out", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2F$/);

  await signInThroughBypass(page);
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  await context.close();
});
