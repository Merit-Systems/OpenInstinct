import { expect, type Page } from "@playwright/test";

const defaultPhoneNumber = "+12025550123";

export async function signInThroughBypass(
  page: Page,
  phoneNumber = defaultPhoneNumber
) {
  const outcomes: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each retry must finish navigation before the next attempt.
    await page.goto("/sign-in");
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each retry must finish navigation before the next attempt.
    await page.getByLabel("Phone number").fill(phoneNumber);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each retry must finish navigation before the next attempt.
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // oxlint-disable-next-line eslint/no-await-in-loop -- Each retry must finish navigation before the next attempt.
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
