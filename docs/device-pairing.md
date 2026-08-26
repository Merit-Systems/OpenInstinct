# Hosted surfaces and the local trust boundary

Local Vault Assistant is one personal agent with two execution zones:

- Hosted surfaces provide web chat, external chat adapters, durable task
  coordination, and cloud browser execution.
- The device runtime owns raw credentials, identity data, provider refresh
  tokens, local inference, approvals, and privileged connectors.

The hosted service must never become a second vault. Pairing should give each
device a public identity and an encrypted request channel, not a way to export
its secrets.

## Capability request flow

1. A hosted surface turns the user's intent into a narrow capability request,
   such as `email.search`, `email.draft`, or `browser.checkout`.
2. The request is encrypted to a paired device and bound to the user, device,
   scope, expiration, and originating conversation.
3. The device evaluates local policy and asks for approval when the action is
   sensitive, irreversible, or outside an existing grant.
4. A local connector uses the credential without returning it to the hosted
   service.
5. The device returns the smallest useful result and an audit record.

The system must fail closed when the paired device is offline. Hosted surfaces
can queue a request, but they cannot silently replace the local execution path
with a cloud-held credential.

## Email without full god mode

OAuth refresh tokens and any local mail index stay on the device. The connector
should expose purpose-built operations rather than a generic provider token:

- `email.search(query, fields, limit)` returns only requested fields.
- `email.read(messageIds)` fetches explicit messages after policy checks.
- `email.draft(recipients, subject, body)` creates a reviewable draft.
- `email.send(draftId, approval)` requires a recent approval or a narrowly
  configured local rule.

Bulk export, arbitrary provider API calls, forwarding rules, account settings,
and destructive mailbox operations should be unavailable by default. Policies
can further constrain accounts, recipients, message age, attachment handling,
and the amount of content returned to hosted inference.

## Current implementation

The hosted root links to the stable device manager URL. Hosted chat and the
local vault are not paired yet, so the UI states that limitation directly. The
next implementation milestone is device identity, encrypted request delivery,
and a local capability/approval broker.
