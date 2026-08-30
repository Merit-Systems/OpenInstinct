import { expect, test } from "@playwright/test";
import { signInThroughBypass } from "./helpers";

test("hides the admin surface from a signed-in non-admin", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await signInThroughBypass(page, "+12025550124");
  await page.goto("/admin");

  await expect(page.getByText("404")).toBeVisible();
  await context.close();
});

test("shows the admin overview to the configured administrator", async ({
  page,
}) => {
  await page.goto("/admin");

  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Admin overview" })
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByLabel("System counts")
  ).toBeVisible();
});
