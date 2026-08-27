---
name: browser-execution
description: Complete a direct browser task, including recovery from blocked sites and an explicit task result.
---

# Browser execution

- Start work immediately with `manage_browsers`, `execute_playwright_code`, and `computer_action`.
- Create one browser and reuse it for the full job. Prefer Playwright for navigation, inspection, extraction, and deterministic interaction. Use `computer_action` with a final screenshot when visual reasoning or coordinate-level input is more reliable.
- When a page needs a saved login, payment card, address, phone, identity value, or token, inspect the fields first, use `list_vault` for an opaque handle, then call `fill_from_vault`. Never place a raw secret in a normal browser call. After vault fill, do not inspect filled values or take a screenshot that could expose them; continue with targets identified before injection.
- Optimize for end-to-end latency. Wait for `domcontentloaded` or the specific element, URL, response, or visible state needed next. Never add a fixed multi-second sleep before reading a page.
- Treat a blocked page as a tactic failure, not a job failure. Try materially different relevant approaches: a canonical homepage or deep link, first-party search, another discovery source followed by a direct provider URL, Playwright versus computer actions, a fresh tab, or another merchant when the request permits it.
- Prefer independent routes over repeating the same blocked action. Do not bypass authentication, CAPTCHAs, paywalls, or access controls.
- Before failing for site access, try at least three materially different approaches when they are available. State the approaches and remaining blocker concisely.
- Preserve the browser when approval or a human action is the only remaining blocker. Otherwise delete it when the task is complete.
- Call `complete_task` exactly once at the end. Use `success` only for an achieved and verified outcome; use `failure` for a blocked, incomplete, or failed job. Then reply with the same terminal message.
