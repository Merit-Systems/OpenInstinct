import { expect, test } from "@playwright/test";

test("loads the authenticated workspace, chat, and vault surfaces", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(
    navigation.getByRole("link", { name: "Workspace", exact: true })
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Vault", exact: true })
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Chat", exact: true })
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "All chats", exact: true })
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Tasks", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();

  await page.goto("/chat");
  await expect(page.getByPlaceholder("Send a message…")).toBeVisible();

  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Vault" })).toBeVisible();
});
