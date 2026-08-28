---
description: Complete a bounded task on a known website using the browser and vault safely.
---

# Browser execution

## Start and navigate

- Create one browser for the assignment and reuse it. Pass the known target as `start_url`; do not list old sessions first.
- Start read-only. Immediately before using a saved login, record the current URL, delete the browser, and recreate it there with `save_changes: true`. Only one writable profile session may exist. Delete it as soon as authentication succeeds so the login state is saved.
- Prefer Playwright for navigation, inspection, extraction, and deterministic interaction. Use computer actions when visual or coordinate-level input is more reliable.
- Make each Playwright call do one coherent unit of work: inspect, perform related safe actions, verify the result, and return a compact object. Re-enter the model only for a meaningful transition, unknown state, approval, or recovery.
- Wait for `domcontentloaded` or a specific locator, URL, response, or visible state. Never use `networkidle`, fixed multi-second sleeps, or open-ended polling. Keep ordinary locator waits at five seconds or less and computer-action sleeps at two seconds or less.

## Vault and authentication

- For a saved login, card, or address, call `list_vault`, choose an opaque compatible handle, focus one visible control in the intended form, then call `fill_from_vault` with only that handle and browser session ID.
- On a multi-step login, advance the page and fill again for the next visible credential field. After any vault fill, never inspect the filled value or capture it in an image; continue using targets identified before injection.
- If fill fails, report the tool error and last verified page state. Do not guess at cross-origin or provider limitations.
- If an item is missing, report its supported kind (`login`, `payment`, `address`, or `contact`) and safe setup metadata. For a login, include a descriptive label, identifier type (`email`, `phone`, or `username`), and exact origin, but never the identifier.
- Ask the coordinator for a textual OTP. Preserve the browser, enter the returned code once, and continue. Use live view for non-textual authentication only.

## Images

- Treat computer-action screenshots as temporary inspection data. Use `capture_browser_image` only when requested or when one image materially improves verification or comparison.
- For an item's photo or image, prefer `image_resource` on the matching visible image. Use a viewport, full-page, or element screenshot when page context was requested or no suitable image resource exists.
- Return one useful image for a single result. Return two to four only for a genuinely visual comparison. Never persist sensitive, decorative, repetitive, or routine debugging images.

## Transactions and recovery

- Submit a transaction only when the assignment authorizes the exact merchant, item, quantity, option, fees, and total. Approval remains valid at that total or lower. If approval is absent, the total rises, or a material term changes, preserve the browser and return the exact decision payload.
- After approval, fill and submit in the same run. A merchant review page or personal authentication challenge does not require another price approval.
- Let Kernel's managed solver handle a CAPTCHA or Cloudflare challenge. Do not click it. Wait once for at most 20 seconds, inspect once, and continue if cleared. Otherwise preserve the browser and return the live-view takeover blocker.
- For other blocked states, try at most two materially different tactics. If both fail, return the last verified state and exact blocker. An uncomplicated task should stay near 90 seconds and six browser tool calls.

Delete the browser on success or terminal failure. Keep it only when approval, vault setup, authentication, CAPTCHA, or takeover must happen before the same assignment can continue.
