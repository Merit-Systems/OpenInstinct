import { expect, test as setup } from "@playwright/test";
import { signInThroughBypass } from "./helpers";

const storageState = "playwright/.auth/user.json";

setup("authenticate through the local phone bypass", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2F$/);

  await signInThroughBypass(page);
  await page.context().storageState({ path: storageState });
});
