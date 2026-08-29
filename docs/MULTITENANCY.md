# Multi-tenancy design: Vercel-first

This document defines the target for multiple customer workspaces. It is a
design contract, not an implemented claim. The recommended first production
platform is Vercel because the current application already relies on Vercel
Connect, Blob, AI Gateway, and Vercel workflow services.

The existing `workspaces` table is the canonical tenant and billable boundary
for this evolution. Extend `workspaces` and `workspace_memberships`; do not add
a parallel tenant owner table unless a deliberate future rename migration is
approved. Provider identity and installation mapping tables may use
tenant/workspace-keyed names, but their ownership must resolve back to the
canonical workspace.

## Recommended evolution

Stage the change around the boundary that already exists:

1. Preserve each current workspace as the initial tenant boundary.
2. Make personal workspaces explicit, member-authorized, observable, and
   operable before adding shared access.
3. Decide phone-first and email invitation semantics, including verification,
   recovery, and ownership transfer.
4. Decide the Linq line model (one managed line per tenant versus bring your
   own line) before enabling shared organizations.
5. Add shared organizations only after those identity and channel contracts are
   tested end to end.

Better Auth Organizations is a candidate for membership/session primitives, not
a committed dependency. Phone-first invitations, parallel ownership, active
tenant selection, and provider-line ownership must be resolved before adopting
it.

## Current state, gap, and target

| Area        | Current                                            | Gap                                                      | Target                                             |
| ----------- | -------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Workspace   | One deterministic personal workspace per principal | No shared organization or active-tenant concept          | Extended workspace/tenant entity with lifecycle    |
| Membership  | Composite membership row, owner role only          | No invitations, roles, or membership management          | Owner/admin/member roles with server authorization |
| Identity    | Better Auth user and Linq provider principal       | Channel identities are not unified for every tenant mode | One identity map with verified provider subjects   |
| Channels    | One configured Linq line per deployment            | No tenant routing or BYO line model                      | Tenant-bound line/install routing                  |
| Connections | Vercel Connect installation IDs                    | Installation ownership is implicit                       | Installation-to-tenant records and checks          |
| Storage     | Workspace columns and private Blob objects         | No tenant quotas, export, or retention controls          | Tenant-scoped storage, limits, lifecycle jobs      |
| Usage       | Per-chat token/cost fields                         | No aggregate ledger or billing authority                 | Immutable usage ledger with billing reconciliation |
| Workflow    | Eve sessions and local/Vercel workflow state       | No tenant-aware operations console                       | Tenant-scoped runs, retention, and support access  |

## Isolation invariant

Every request resolves exactly one tenant/workspace server-side from an
authenticated principal and a membership record. A client-supplied workspace
ID is a selector at most, never an authority. The server must verify that the
principal belongs to the selected tenant, has the required role, and that the
resource belongs to that tenant before every read, write, external call, and
background continuation.

Service APIs should accept a typed scope object containing tenant ID, principal
ID, and role claims. Keep workspace predicates in every query and preserve
composite foreign keys. PostgreSQL RLS is a useful defense in depth, but it
must not replace application authorization or transaction-level scope setup.

## Identity and membership

The target model separates these concepts while keeping workspace canonical:

- `user`: Better Auth identity and authentication lifecycle.
- `workspace`: canonical billable customer boundary and data owner (the tenant
  product concept).
- `workspace_membership`: user-to-workspace relationship, role, status, timestamps, and
  invitation provenance.
- `workspace_identity`: verified external subject mapping, provider, and
  workspace.
- `workspace_installation`: provider connection/line installation owned by a
  workspace.

The active tenant must come from a server-issued session claim or a server-side
membership lookup. Switching tenants rotates the effective scope and must
invalidate or re-check active Eve sessions, workers, browser profiles, and
connection grants.

Roles should begin with owner, admin, and member. Sensitive operations need
capability checks in addition to role checks: vault administration, connection
management, spending policy, support access, export, and tenant deletion.

## Channels and connections

### Linq

The product must choose one of these explicit models:

1. **One line per deployment**: simple and compatible with the current global
   `LINQ_CONNECTOR`/`LINQ_PHONE_NUMBER`, but all tenant routing and reputation
   share one line.
2. **One managed line per tenant**: strongest identity and billing boundary,
   with more provisioning, compliance, and webhook routing work.
3. **Bring your own line**: customers supply or authorize their own Linq
   installation. This reduces shared reputation risk but increases OAuth/API
   support and offboarding complexity.

Inbound messages must resolve `(provider, sender, line, installation)` to one
tenant before starting an Eve session. Persist the mapping and reject
ambiguous or unverified senders. Replies must use the same installation and
tenant context as the inbound event.

### Google Workspace and Vercel Connect

Persist an installation record containing provider, Vercel Connect connector
ID, tenant ID, authorization subject, scopes, status, and created/rotated times.
Never infer tenant from a connector ID supplied by a browser. The authorization
subject must be derived from the verified tenant membership and the connector
installation selected by server policy.

### Kernel and Blob

Kernel browser profiles, browser sessions, image manifests, and Blob object
prefixes must include an opaque tenant namespace. Every lookup must verify the
tenant before contacting the provider. Do not use a user hash as a substitute
for a membership-aware tenant namespace once shared workspaces exist.

## Billing, quotas, and abuse controls

Create an append-only usage ledger keyed by tenant, user, provider, model,
workflow/session, and operation. Record model tokens, provider cost, browser
runtime, storage bytes, connector calls, and externally visible actions. Chat
summary fields may remain a view/cache, not the billing authority.

Enforce tenant limits before expensive work:

- concurrent Eve sessions and worker tasks;
- browser lifetime and profile writers;
- model tokens and estimated spend;
- Blob bytes, image count, and retention;
- Linq messages and outbound actions;
- Google/API request budgets.

Use provider/webhook rate limits, OTP attempt limits, abuse flags, circuit
breakers, and an operator quarantine state. Budget failures must be explicit to
the user and durable enough to prevent a retry storm.

## Lifecycle, privacy, and support

Tenant states should include trial, active, suspended, pending deletion, and
deleted. Suspension stops new sessions and external actions while preserving
enough state for support and export. Deletion must revoke provider grants,
delete or cryptographically render vault data inaccessible, remove Blob and
Kernel objects, cancel workflows, and retain only the minimum audit/legal data.

Support access must be time-bound, tenant-scoped, explicitly audited, and
unable to reveal vault plaintext. Exports must be authenticated, encrypted in
transit and at rest, rate-limited, and expire automatically. Define retention
for messages, workflow events, screenshots, usage, audit events, and provider
diagnostics before launch.

## Observability

Every request, Eve session, worker task, workflow run, provider call, and audit
event should carry tenant ID, installation ID where relevant, and a correlation
ID. Do not put phone numbers, tokens, vault contents, or page secrets in logs.
Dashboards and alerts must support tenant-scoped views without allowing one
customer to query another customer's identifiers.

## Horizontal scaling risks

- Linq channel state, webhook deduplication, and thread continuity need a
  durable/idempotent multi-instance contract; this review does not assert a
  particular in-memory implementation.
- Eve workflow persistence and task-history behavior need durable shared
  storage plus careful single-writer/consumer validation when horizontally
  scaled.
- Kernel profile writer locks need a shared coordination mechanism when workers
  run on multiple instances.
- Webhook retries require durable idempotency keyed by provider event and tenant.
- Blob and Postgres writes need an outbox/reconciliation path for partial failure.

Vercel is the initial recommendation while the current Connect/Blob/workflow
path remains the system of record. Any later Railway or Hetzner design needs a
separate portability review and provider credential implementation.

## Migration stages and gates

1. **Make personal workspaces explicit:** retain deterministic workspace IDs while
   extending workspace/member records with owner authorization, active-tenant
   checks, lifecycle state, and audit visibility. Gate: every existing
   workspace has one explicit owner and all scoped operations are observable.
2. **Model shared membership:** extend workspace/membership records and add
   identity, invitation, installation, policy, usage, and audit records without
   enabling shared writes. Gate: phone/email invitation and ownership-transfer
   decisions are recorded and wrong-tenant access is denied.
3. **Backfill and scope:** backfill each current personal workspace with
   lifecycle fields and its owner membership, then replace derivation with
   membership lookup behind a feature flag. Gate: counts, foreign keys,
   encrypted AAD mappings, and wrong-tenant read/write tests reconcile.
4. **Decide and bind channels:** choose the Linq line model, then bind Linq and
   Google installations to tenants. Gate: sender/line routing, OAuth subject
   mapping, retries, revocation, and invitation tests pass.
5. **Limits and lifecycle:** enable usage ledger, quotas, audit, suspension,
   retention, and deletion. Gate: budget enforcement is tested before model,
   browser, message, and storage calls.
6. **Shared cutover:** enable shared tenants for a controlled cohort. Gate:
   complete web-chat and Linq turns, tenant isolation acceptance, rollback
   rehearsal, and backup restore rehearsal all pass.

Rollback boundaries must be explicit: schema additions are backward compatible;
scope enforcement can be feature-flagged; tenant writes after cutover require
an export/replay strategy. Never roll back encryption/AAD or membership data by
silently recreating a tenant.

## Test strategy

- Unit-test tenant resolution, role/capability policy, provider subject mapping,
  idempotency, quota decisions, and deletion state transitions.
- Integration-test every DB service with two tenants and two members, including
  wrong-tenant IDs, worker lineage, artifacts, secrets, and settings.
- Contract-test each provider webhook and connection installation with retries,
  duplicate events, revoked grants, and malformed tenant mappings.
- Run browser authorization tests proving a worker cannot use another tenant's
  browser, profile, vault item, or artifact.
- Run migration/backfill tests on empty, legacy, partial, and rollback fixtures.
- Exercise a complete web-chat and Linq turn in staging with audit and usage
  records, then rehearse backup restore and tenant deletion.

## Threat-model checklist

- Can a caller select another tenant by changing an ID, cursor, or session ID?
- Can a Linq sender reach a tenant without a verified provider mapping?
- Can a worker child inherit a different tenant than its root session?
- Can retries duplicate a purchase, message, grant, usage charge, or deletion?
- Can support staff or logs expose vault values, OAuth tokens, phone numbers, or screenshots?
- Are quotas checked before external side effects and again on retry?
- Do webhook signatures, replay windows, and installation ownership hold after a proxy hop?
- Does tenant deletion cover Postgres, Blob, Kernel, Eve workflows, provider grants, caches, and logs?

## Open decisions

- Is the first shared-tenant product managed lines or bring-your-own Linq lines?
- Is a Better Auth user allowed to belong to multiple tenants, and how is the active tenant selected?
- Which roles can manage vault, connectors, billing, support, and spending policy?
- Is customer data residency or regional Kernel placement required?
- Which workflow, message, screenshot, and audit retention periods apply?
- What is the billing authority and reconciliation window for provider-reported cost?
- Which provider integrations are Vercel-only at launch?
- What is the approved support escalation path for a stuck or disputed external action?
