# Plan 002: Multi-tenant agent infrastructure epic

GitHub:

- Epic: dennisonbertram/fork-OpenInstinct#1 Multi-tenant agent infrastructure
  on Vercel

## Status: all 10 slices merged (2026-08-29)

| Slice                               | Issue | PR  |
| ----------------------------------- | ----- | --- |
| 1. Workspace tenancy foundation     | #2    | #4  |
| 2. Server-resolved active scope     | #5    | #7  |
| 3. Agent resource and revisions     | #6    | #9  |
| 4. Verified phone identity          | #8    | #11 |
| 5. Shared-line conversation binding | #10   | #13 |
| 6. Connection installations         | #12   | #15 |
| 7. Usage ledger and quotas          | #14   | #17 |
| 8. Tenant lifecycle enforcement     | #16   | #19 |
| 9. Platform API v1 and credentials  | #18   | #21 |
| 10. Webhook outbox                  | #20   | #22 |

`WORKSPACE_SCOPE_ENFORCEMENT` defaults to `off`; every tenancy check activates
only when it is set to `enforce`. Follow-ups: #23 (SECURITY-01 browser
approval boundary), #24 (deferred items: drain scheduler, SSRF DNS
resolution, plaintext user phone column, api-credential purge gap, flag
rollout gates).

This file mirrors the epic issue so the slice plan is versioned next to the
design docs it implements (`docs/MULTITENANCY.md`, `docs/PRODUCT_DIRECTION.md`,
`docs/ARCHITECTURE_REVIEW.md`). The issue is the working copy; update both
together.

## Why this matters

Today the application gives each authenticated user one deterministic personal
workspace (`lib/access-scope.ts`), one owner-only membership row, and one
deployment-level Linq line. There is no shared membership, no workspace-owned
agent resource, no usage ledger, no tenant lifecycle, and no customer API. The
design docs on this branch commit to a direction: build agent infrastructure
first, on one shared Vercel deployment, with the existing `workspaces` table as
the canonical tenant and billable boundary.

This epic turns that design into PR-sized implementation slices.

## Product thesis

- **Workspace is the tenant.** Extend `workspaces` and `workspace_memberships`.
  Do not add a parallel tenant table.
- **Agent is a workspace-owned resource.** An `agent` has immutable published
  `agent_revisions`. New sessions pin one workspace/agent/revision tuple. A
  publish never silently widens a running session.
- **Shared platform number is the default ingress.** Tenancy resolves from a
  verified phone identity plus a durable server-owned conversation binding —
  never from the destination line, and never from message text.
- **Isolation invariant.** Every request resolves exactly one tenant
  server-side from an authenticated principal and a membership record. A
  client-supplied workspace or agent ID is a selector at most, never an
  authority.

## User/operator path protected

An owner signs up and receives one workspace. The owner creates one agent,
publishes an immutable revision, and verifies a phone identity with that agent
as the default. The owner texts the shared platform number. The signed provider
event is deduplicated, bound to the verified identity, workspace, agent, and
pinned revision, and produces one Eve session turn with usage and audit
records. Web chat uses the same control plane. Suspension stops new turns
without deleting evidence.

## Follow-up slices

Each slice is one PR with its own tests and an additive migration where schema
changes.

1. **Workspace tenancy foundation** (#2): extend `workspaces` (lifecycle state,
   plan, policy version, timestamps) and `workspace_memberships`
   (owner/admin/member roles, status), backfill one explicit owner per existing
   workspace, no behavior change. Gate: two-tenant wrong-tenant tests pass;
   every workspace has one explicit owner.
2. **Server-resolved active scope**: typed scope object (tenant ID, principal
   ID, roles) through db/services; membership-lookup resolution behind a
   feature flag replacing pure derivation. Gate: wrong-tenant reads/writes are
   denied in integration tests.
3. **Agent resource and revisions**: `agents`, `agent_revisions`,
   active-revision pointer, publish/rollback, session pinning. Gate: every new
   session records one validated workspace/agent/revision tuple; rollback is
   auditable.
4. **Verified phone identity**: `phone_identities` with encrypted normalized
   number, lookup hash, verification and recycling state, linked to the Better
   Auth user via the existing OTP flow. Gate: unverified senders cannot create
   bindings.
5. **Shared-line conversation binding**: `platform_lines`,
   `channel_conversations`, `channel_participants`; webhook signature
   verification, replay window, and event dedupe; the six-step resolver from
   `docs/PRODUCT_DIRECTION.md`; fail closed on ambiguity. Gate: two tenants
   complete turns on one staging number with no cross-tenant state, and
   ambiguous routing is rejected.
6. **Connection installations**: `connection_installations` (provider,
   connector ID, tenant, authorization subject, scopes, status); membership
   verified at authorization time for Google/Linq via Vercel Connect. Gate:
   wrong-tenant installation use fails closed.
7. **Usage ledger and quotas**: append-only `usage_events` plus `audit_events`;
   budget checks before model, browser, message, and storage side effects.
   Gate: budget enforcement is tested before each expensive call class.
8. **Tenant lifecycle enforcement**: trial/active/suspended/pending-deletion/
   deleted states; suspension stops new sessions and side effects; deletion
   covers Postgres, Blob, Kernel, workflows, and provider grants. Gate:
   deletion rehearsal on fixtures.
9. **Platform API v1 and credentials**: `api_credentials` (hashed, scoped,
   shown once), first `/v1` endpoints (agents, revisions, sessions, messages),
   `Idempotency-Key` on creation and delivery. Gate: key rotation, revocation,
   and wrong-tenant contract tests.
10. **Webhook outbox**: `webhook_endpoints` and `webhook_deliveries`; signed
    raw-body delivery, bounded retries, replay controls. Gate: replay,
    rotation, and duplicate-delivery tests.

Slices 1–4 have no dependency on the open commercial decisions (billing
authority, Sendblue terms, dedicated-line pricing). Slice 5 needs the provider
webhook contract confirmed. Slices 7–10 need the billing and retention
decisions from "Decisions required before implementation" in
`docs/PRODUCT_DIRECTION.md`.

Related but not in this epic: [SECURITY-01] in `docs/ARCHITECTURE_REVIEW.md`
(deterministic approval at the browser tool boundary) is high severity and must
land before shared tenants go live; it deserves its own issue.

## Out of scope

- The consumer text-to-create shell and group/guest participation.
- Dedicated or bring-your-own provider lines (later premium mode).
- Arbitrary customer JavaScript or arbitrary customer MCP endpoints (Stage 2
  broker is a later epic).
- Multi-agent selection over SMS, invitations, and explicit agent switching.
- Shared organization administration (invites, ownership transfer) until the
  identity and channel contracts are tested.
- Adopting Better Auth Organizations (candidate only) and the Sendblue adapter
  migration (separate acceptance test).
- Hetzner/Railway portability.
