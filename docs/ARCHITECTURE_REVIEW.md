# OpenInstinct architecture review

Review base: `480045dbc63008e7f99313d1683858cd8657b35a` (2026-08-29).

This is a source review of the repository's current behavior. It covers the
Next.js host, Eve runtime, authentication, workspace scoping, persistence,
browser worker, integrations, local development, and deployment assumptions.
It does not claim that the warning in `README.md` has been lifted.

## Topology and data flow

```text
Browser / iMessage
        |
        v
Next.js app -----------------------> Better Auth + tRPC
  |  proxy.ts                               |
  |                                        v
  +-- /eve/v1/* <-------------------- Postgres / Drizzle
          |
          v
     Eve root agent -- delegated worker --> Kernel browser/profile
          |                    |
          +--> AI Gateway     +--> encrypted vault + private Blob images
          +--> Linq / Google through Vercel Connect
          +--> workflow runtime and task history
```

The web session enters through Better Auth, is converted to a principal, and
then to a deterministic personal workspace. The root Eve agent uses that
workspace for model settings, memory, sessions, and tool authorization. Browser
tools are only under the worker agent and must prove both worker and root
session ownership before using Kernel or the vault.

## Subsystem ownership

| Concern                       | Current owner                                                             | Boundary                                          |
| ----------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| Web host and route protection | `next.config.ts`, `proxy.ts`, `app/`                                      | Next request/session boundary                     |
| Phone authentication          | `auth/index.ts`, `auth/linq.ts`, `auth/session.ts`                        | Better Auth session and Linq delivery             |
| Eve web auth                  | `agent/channels/eve.ts`                                                   | Better Auth cookie plus session ownership         |
| iMessage/SMS                  | `agent/channels/linq.ts`                                                  | Linq webhook and thread adapter                   |
| Root coordination             | `agent/agent.ts`, `agent/instructions.md`                                 | User-facing agent and policy                      |
| Browser execution             | `agent/subagents/worker/`                                                 | Delegated worker plus Kernel ownership checks     |
| Workspace identity            | `lib/access-scope.ts`, `lib/request-scope.ts`                             | Server-derived scope                              |
| Application storage           | `db/schema/`, `db/services/`, `db/index.ts`                               | Drizzle/Postgres                                  |
| Secret storage                | `lib/manager/server/secret-store.ts`                                      | AES-256-GCM before database storage               |
| Browser image storage         | `lib/browser-images/server.ts`, `app/artifacts/[artifactId]/route.ts`     | Private Blob plus scoped manifest                 |
| Task history                  | `lib/task-history/server.ts`                                              | Workflow world listing filtered by owned sessions |
| Integrations                  | `lib/google-workspace/`, `agent/lib/google-workspace/`, `@vercel/connect` | Vercel Connect installations                      |

## Trust and persistence boundaries

- Better Auth is the web identity authority. The current Linq dispatch maps a
  verified phone to that identity, but otherwise retains Linq's provider
  principal as a channel identity.
- `AccessScope` is always constructed server-side in request and channel code.
  Application queries include workspace predicates, and session-bearing rows
  use composite membership foreign keys.
- Vault plaintext is accepted only at the manager boundary and encrypted with
  AES-256-GCM using `SECRET_ENCRYPTION_KEY` and workspace/id AAD. Metadata never
  contains the secret value.
- Kernel is an external browser runtime. Persistent profiles are keyed by a
  workspace hash, with a database advisory lock around profile writers.
- Browser image manifests and Blob objects are private and user/workspace
  scoped. The artifact route also validates UUIDs and emits restrictive headers.
- Postgres is pooled at request time; migration commands use the direct
  `DATABASE_URL_UNPOOLED` connection. Local development owns a Docker Compose
  Postgres lifecycle through `scripts/dev.mjs`.
- Local Eve workflow state is process/disk dependent. Vercel production uses
  Vercel workflow infrastructure; task-history code currently assumes the
  Vercel world directly.

## Vetted findings

### [SECURITY-01] Enforce consequential browser approvals at the tool boundary

- **Evidence**: `agent/instructions.md:21` — approval is specified as model guidance.
- **Evidence**: `agent/subagents/worker/tools/computer_action.ts:104-125` — arbitrary clicks, typing, clipboard writes, and key presses execute without an approval field.
- **Evidence**: `agent/subagents/worker/tools/execute_playwright_code.ts:24-41` — bounded Playwright still has no server-side transaction approval.
- **Impact**: A page prompt injection or model error can submit an external purchase, message, or destructive change without a deterministic approval check.
- **Effort**: L
- **Risk**: HIGH — a broker change affects all browser workflows.
- **Confidence**: HIGH
- **Fix sketch**: Require a server-issued approval capability bound to the worker, target, action, and transaction terms before consequential browser operations.

### [TENANCY-01] Make the personal workspace an explicit, member-authorized tenant

- **Evidence**: `lib/access-scope.ts:17-26` — workspace identity is deterministically derived as `personal:<hash(userId)>`.
- **Evidence**: `db/services/scope.ts:6-22` — the first scoped write creates that workspace and an `owner` membership.
- **Evidence**: `db/schema/application.ts:19-38` — membership permits only the owner role.
- **Impact**: The current model is strong per-user workspace isolation, but it has no explicit active-tenant selection, shared membership, invitation lifecycle, or tenant-level authorization contract.
- **Effort**: M
- **Risk**: HIGH — changing scope resolution affects every persisted and external side effect.
- **Confidence**: HIGH
- **Fix sketch**: Preserve and extend `workspaces` as the canonical tenant and billable boundary; add explicit member authorization to `workspace_memberships` and server-side active-scope checks before introducing shared organizations. Do not create a parallel tenant owner table.

### [TENANCY-02] Resolve the shared provider conversation before tenant work

- **Evidence**: `lib/env.ts:54-76` — one `LINQ_CONNECTOR` and one `LINQ_PHONE_NUMBER` configure a deployment.
- **Evidence**: `agent/channels/linq.ts:76-84` — the channel uses that single configured connector and has no tenant installation lookup.
- **Evidence**: `auth/linq.ts:60-76` — OTP delivery uses the same deployment connector.
- **Impact**: The deployment line is intentionally suitable as shared platform
  ingress, but the current code has no durable provider-conversation-to-agent
  binding. Sender plus destination line becomes ambiguous when one participant
  can reach multiple tenant agents, and a routing error could cross tenants.
- **Effort**: L
- **Risk**: HIGH — routing, replay/idempotency, and provider offboarding need an end-to-end contract.
- **Confidence**: HIGH
- **Fix sketch**: Verify and deduplicate provider webhooks, then persist
  `(provider, provider account ID, provider conversation ID)` to platform line,
  verified phone identity, tenant, agent, participant set, and pinned revision.
  Allow a new binding only when the identity has exactly one active/default
  agent; otherwise enter explicit onboarding/selection and fail closed.
  Dedicated/BYO lines are later premium modes, not the MVP tenant boundary.

### [TENANCY-03] Treat Google grants as user-scoped until installation ownership exists

- **Evidence**: `lib/google-workspace/config.ts:16-27` — Connect subjects are derived from `userId` and typed as a user subject.
- **Evidence**: `lib/google-workspace/server.ts:12-17,34-53` — token lookup and authorization use the user-derived subject with one deployment connector UID.
- **Impact**: A Google grant is currently associated with an authenticated user, not a tenant-owned installation; shared-tenant access and offboarding semantics are undefined.
- **Effort**: M
- **Risk**: HIGH — an incorrect mapping could expose mail, calendar, or contacts across members.
- **Confidence**: HIGH
- **Fix sketch**: Keep user-scoped grants explicit in the first stage; later persist a tenant installation record, verify membership at authorization time, and define whether grants are personal or shared before migration.

### [TENANCY-04] Add tenant quotas, usage authority, audit, and lifecycle controls

- **Evidence**: `db/schema/application.ts:14-37` — the current schema has workspaces and owner-only memberships but no lifecycle, billing, or quota state on the canonical workspace boundary.
- **Evidence**: `db/services/chats.ts:22,76-96` — usage is stored as per-chat token/cost fields rather than an append-only tenant ledger.
- **Evidence**: `lib/manager/server/store.ts:43-48` — vault imports have no tenant quota or audit operation.
- **Impact**: There is no durable tenant-level budget, abuse/suspension state, retention/deletion workflow, or auditable external-action ledger for shared usage.
- **Effort**: L
- **Risk**: HIGH — quotas and deletion must cover model, browser, messaging, Blob, workflow, and provider side effects.
- **Confidence**: HIGH
- **Fix sketch**: Extend `workspaces` with lifecycle/policy state and add append-only usage, quota, and audit records keyed by that workspace boundary before enabling shared tenants.

### [CORRECTNESS-01] Make bulk vault imports atomic

- **Evidence**: `lib/manager/index.ts:105-114` — imports accept up to 3,000 entries.
- **Evidence**: `lib/manager/server/store.ts:43-48` — entries are written one at a time.
- **Evidence**: `lib/manager/server/store.ts:61-76` — secret and metadata writes are separate.
- **Impact**: Failures leave partial imports and potentially orphaned encrypted rows.
- **Effort**: M
- **Risk**: MED — retry behavior changes.
- **Confidence**: HIGH
- **Fix sketch**: Validate the whole batch before a transactional/idempotent repository operation.

### [CORRECTNESS-02] Test the Linq webhook against the Next proxy

- **Evidence**: `proxy.ts:6-12,24-25` — `/eve/v1/linq` is not excluded from the app auth redirect.
- **Evidence**: `README.md:84-89` — Linq triggers target `/eve/v1/linq`.
- **Impact**: On non-Vercel rewrites, a webhook without a browser cookie may be redirected before Eve verifies it.
- **Effort**: S
- **Risk**: MED — route bypass must preserve Eve's signature verifier.
- **Confidence**: MED
- **Fix sketch**: Add a route-level integration test and adjust the proxy only if the actual self-host topology confirms interception.

### [PERF-01] Batch vault secret-presence checks

- **Evidence**: `lib/manager/server/vault.ts:6-18` — one `hasSecret` call runs per listed item.
- **Evidence**: `lib/manager/server/secret-store.ts:44-53` — each call performs a database read.
- **Impact**: A manager snapshot performs one query plus one query per vault item.
- **Effort**: S
- **Risk**: LOW — localized query change.
- **Confidence**: HIGH
- **Fix sketch**: Use one scoped join or grouped query for metadata and secret presence.

## Deferred portability findings

These are intentionally deferred while the supported deployment remains
Vercel-first. They explain why Hetzner/Railway cannot be treated as equivalent
targets without implementation and verification work:

- **DEPLOY-01** — `agent/channels/linq.ts:76-84`,
  `auth/linq.ts:1-4,84-90`, and `.env.example:18-22` show
  that Linq is configured through Vercel Connect; portable API-key and
  webhook-signature mode is not implemented.
- **DEPLOY-02** — `lib/model-catalog/server.ts:3-7` and
  `agent/agent.ts:9-15` use the AI SDK Gateway, while
  `.env.example:1-25` does not document a self-hosted
  `AI_GATEWAY_API_KEY` path.
- **DEPLOY-03** — `lib/google-workspace/server.ts:1-17,38-53` and
  `agent/lib/google-workspace/client.ts:1-30` use Vercel Connect
  for OAuth; portable encrypted direct OAuth storage is not implemented.
- **ARCH-01** — `package.json:21-24` and
  `lib/task-history/server.ts:3,13-30` directly construct the Vercel
  workflow world, so self-host task history and workflow persistence still need
  a runtime adapter and compatibility tests.

## Considered and rejected

- Workspace isolation was traced through service predicates, composite membership
  foreign keys, worker lineage, browser sessions, and artifact routes. No direct
  cross-workspace read/write was found in the reviewed paths.
- Artifact traversal was not reported: storage paths are server-generated,
  filenames are sanitized, and reads require scoped manifest lookup plus hash
  verification.
- No SQL or command injection was found in the reviewed application services;
  browser execution is intentionally delegated to Kernel.
- No committed production credential pattern was found. Any credentials shared
  outside the repository should still be rotated.
- The Linq fallback for unverified provider principals was left as an explicit
  product/security decision: the current design may intentionally treat Linq's
  contact allowlist as its channel trust boundary.

## Current limitations

- Vercel Connect, Vercel Blob, AI Gateway, and the workflow history adapter create
  substantial Vercel coupling.
- Local phone auth has a development-only bypass and is not a real Linq round trip.
- Linq currently assumes one globally configured line/connector per deployment;
  that matches the new shared-number product direction but lacks the durable
  conversation resolver required for safe multitenancy.
- Kernel browser execution and Blob browser artifacts are external dependencies.
- Self-hosted workflow persistence requires persistent Eve output/state storage
  and is not equivalent to the current task-history adapter.
- The repository explicitly warns that it is not intended for production use.

## Verification

- `pnpm vitest run tests/init-script.test.ts`: passed after adding the bootstrap tests.
- `pnpm check`: passed with lint, types, tests, formatting, Knip, and boundaries.
- `pnpm build`: passed with synthetic non-secret build environment values.
- `pnpm audit --prod --json`: zero high/critical advisories; one moderate optional transitive advisory.
- `git diff --check`: passed.

After this source review, the same documented revision line was deployed to the
Vercel reference project with Neon, Kernel, private Blob, and a Linq connector.
The dated operational evidence and exact deployment ID live in
[`operations/VERCEL.md`](operations/VERCEL.md). That evidence proves the named
deployment and non-message smoke only; it does not close the architecture
findings or make the application truly multi-tenant.

## Not audited

The source-review phase itself did not exercise live provider calls,
infrastructure provisioning, DNS/TLS, reverse-proxy deployment, browser UI, or
production data. Later deployment checks are recorded separately in the
operator runbook so source findings are not silently conflated with live proof.
