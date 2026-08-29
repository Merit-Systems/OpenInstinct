import { expect, type Page } from "@playwright/test";

const phoneNumber = "+12025550123";

export async function signInThroughBypass(page: Page) {
  const outcomes: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/sign-in");
    await page.getByLabel("Phone number").fill(phoneNumber);
    await page.getByRole("button", { name: "Continue locally" }).click();

    const outcome = await page
      .waitForURL(/\/(?:$|sign-in\?$)/, { timeout: 15_000 })
      .then(() =>
        page.url().endsWith("/sign-in?")
          ? ("native-submit" as const)
          : ("authenticated" as const)
      )
      .catch(() => "timeout" as const);
    outcomes.push(outcome);

    if (outcome === "authenticated") return;
  }

  await expect(page, `sign-in attempts: ${outcomes.join(", ")}`).toHaveURL("/");
}
