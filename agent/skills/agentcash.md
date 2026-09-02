---
name: agentcash
description: Use Agentcash to discover, inspect, and call x402- or MPP-protected APIs with a deployment wallet and one native approval for each paid request.
---

# Agentcash x402 access

Agentcash is OpenInstinct's paid-API gateway. It handles SIWX, x402, and MPP payment proofs. Never use Masterkey.

## Workflow

1. If the task clearly maps to a known origin, skip search and call `agentcash_discover_api_endpoints` directly:
   - people/company, web search, scraping, Maps, email verification, or news: `https://stableenrich.dev`
   - social platform data: `https://stablesocial.dev`
   - image or video generation: `https://stablestudio.dev`
   - file/site hosting: `https://stableupload.dev`
   - email: `https://stableemail.dev`
   - phone calls/numbers: `https://stablephone.dev`
   - jobs: `https://stablejobs.dev`
   - travel: `https://stabletravel.dev`
   - browser automation: `https://stablebrowser.dev`
2. Only when no known origin fits, call `agentcash_search`.
3. Discover the origin and read its guidance.
4. Call `agentcash_check_endpoint_schema` for the exact endpoint and request body. For dynamic prices, include the sample body to obtain an exact quote.
5. Call `agentcash_get_balance` before an expensive request. If funds are insufficient, call `agentcash_list_accounts` and give the user the returned deposit link; never expose private keys.
6. Show the endpoint, purpose, quoted or maximum cost, protocol/network when known, and request summary. Then call `agentcash_fetch` with the smallest safe `maxAmount`; Eve's native tool control is the single approval prompt for the charge. Do not ask for a separate conversational approval first. The deployment ceiling is authoritative.
7. When a successful paid request returns an async `pollUrl`, call `agentcash_fetch_free` for status checks. It verifies that the exact GET route is SIWX-only and free before fetching, so polling does not create another payment approval. Never resubmit a pending generation. Keep the same payment network across the workflow.

Failed non-2xx requests are not charged. If a paid call fails ambiguously or reports an existing uncertain receipt, do not repay or retry; inspect provider or wallet history first.

Never pass authorization, cookie, API-key, private-key, or wallet-secret headers. Agentcash owns authentication and payment.
