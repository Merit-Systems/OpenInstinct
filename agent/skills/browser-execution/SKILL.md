---
name: browser-execution
description: Complete a direct browser task, including recovery from blocked sites and an explicit task result.
---

# Browser execution

- Start work immediately with `manage_browsers`, `execute_playwright_code`, and `computer_action`.
- Create one browser and reuse it for the full job. Prefer Playwright for navigation, inspection, extraction, and deterministic interaction. Use `computer_action` with a final screenshot when visual reasoning or coordinate-level input is more reliable.
- Use names, email addresses, phone numbers, mailing addresses, and other non-credential form values directly when the user explicitly provides them in the task. Do not require the user to save those values in the vault first.
- When a page needs a saved login, payment card, authentication token, or other secret value, inspect the fields first, use `list_vault` for an opaque handle, then call `fill_from_vault`. Also use the vault when the user refers to a saved address, phone, or identity instead of providing the value directly. Never place a raw secret in a normal browser call. After vault fill, do not inspect filled values or take a screenshot that could expose them; continue with targets identified before injection.
- Never invent vault kinds or fields. `request_vault_setup` can create only `login`, `payment`, `address`, or `phone` items and accepts only `kind`, optional `label`, optional `account`, and `target`. `fill_from_vault` accepts only `username`, `password`, `cardholder_name`, `card_number`, `expiration`, `expiration_month`, `expiration_year`, `cvc`, `billing_postal_code`, `address`, `phone`, `identity`, or `token`.
- Optimize for end-to-end latency. Wait for `domcontentloaded` or the specific element, URL, response, or visible state needed next. Never add a fixed multi-second sleep before reading a page.
- Treat a blocked page as a tactic failure, not a job failure. Try materially different relevant approaches: a canonical homepage or deep link, first-party search, another discovery source followed by a direct provider URL, Playwright versus computer actions, a fresh tab, or another merchant when the request permits it.
- Prefer independent routes over repeating the same blocked action. Do not bypass authentication, CAPTCHAs, paywalls, or access controls.
- Before failing for site access, try at least three materially different approaches when they are available. State the approaches and remaining blocker concisely.
- Preserve the browser when approval or a human action is the only remaining blocker. Otherwise delete it when the task is complete.
- Call `complete_task` exactly once at the end. Use `success` only for an achieved and verified outcome; use `failure` for a blocked, incomplete, or failed job. Then reply with the same terminal message.
