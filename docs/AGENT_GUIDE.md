# Agent repository guide

## Mental model

OpenInstinct is a personal browser-using assistant delivered through a Next.js
web app and an Eve agent runtime. Next owns the authenticated manager UI,
Better Auth, tRPC, and artifact delivery. Eve owns durable sessions, model
turns, channels, tools, and the delegated browser worker. The root agent
coordinates the user conversation; the worker is the only agent allowed to
operate a browser or inject vault values.

The repository is Vercel-first today. Treat self-hosting and multi-tenancy as
documented direction unless a change explicitly implements them.

## Route map

| Route                        | Owner                                          | Purpose                                         |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| `/`                          | `app/(authenticated)/(manager)/page.tsx`       | Workspace manager and connector status          |
| `/chat`, `/chat/[sessionId]` | `app/(authenticated)/(manager)/chat/`          | Web chat and Eve session stream                 |
| `/chats`                     | `app/(authenticated)/(manager)/chats/page.tsx` | Workspace chat list                             |
| `/tasks`, `/runs/[groupId]`  | `app/(authenticated)/(tasks)/`                 | Browser task history and run details            |
| `/vault`                     | `app/(authenticated)/(manager)/vault/`         | Vault metadata and secure setup/import UI       |
| `/api/auth/[...all]`         | `app/api/auth/[...all]/route.ts`               | Better Auth API                                 |
| `/api/trpc/[trpc]`           | `app/api/trpc/[trpc]/route.ts`                 | Authenticated application RPC                   |
| `/eve/v1/*`                  | `agent/channels/`, Eve generated service       | Eve sessions, streams, health, and Linq webhook |
| `/artifacts/[artifactId]`    | `app/artifacts/[artifactId]/route.ts`          | Scoped private browser image delivery           |

`proxy.ts` protects the web surface and authenticated Eve browser sessions.
The Eve channel performs its own session ownership check; do not assume a
Next redirect is an Eve authorization decision.

## Directory ownership and dependency direction

- `app/`: pages, layouts, and browser UI. Call application data through tRPC.
- `components/`: reusable UI primitives and AI presentation components.
- `agent/`: Eve agent declarations, instructions, channels, memory, hooks, and tools.
- `agent/subagents/worker/`: the isolated browser worker and its flat tool surface.
- `auth/`: Better Auth configuration, phone normalization, and Linq OTP delivery.
- `trpc/`: request context and the application router.
- `db/schema/`: Drizzle source of truth; `db/services/` owns scoped queries.
- `lib/`: shared schemas, scope derivation, Kernel, vault, images, models, and adapters.
- `db/migrations/`: committed SQL history. Never hand-edit generated snapshots.
- `scripts/`: local supervisors and benchmark utilities.
- `docs/`: operational and architectural contracts.

The normal dependency flow is `app -> trpc -> lib/db services -> external
provider`. Agent tools may use shared server services, but browser tools stay
under the worker directory. Do not add a root browser connection or move vault
secrets into UI state.

## Identity, tenant, and session flow

```text
Better Auth user/session
          |
          v
accessScopeForUser("better-auth:<userId>")
          |
          v
{ userId, workspaceId: personal:<hash> }
          |
          +--> scoped DB queries and vault
          +--> agent session ownership
          +--> worker root/child lineage checks
          +--> Kernel profile and private image namespace
```

`requireRequestScope()` is the server entrypoint for web requests. Eve channel
auth maps the authenticated request to the same scope. Linq maps a verified
phone to Better Auth and otherwise retains a provider principal; this is an
important trust/product decision for future multi-tenancy. Never accept a
client-supplied workspace ID as authority.

## Browser-worker boundary

The root agent delegates a bounded assignment to `worker`. The worker must use
only its declared tools, an owned browser session, and opaque vault handles.
`requireWorkerScope()` proves both the worker session and its root session are
owned by the current scope. `requireOwnedBrowserSession()` adds the workspace
check before Kernel calls.

Use `list_vault` for safe metadata, then `fill_from_vault` with only the opaque
handle and browser session ID. Never return or inspect injected values. Keep
external action approval explicit in the assignment; the current browser tool
boundary still needs deterministic approval enforcement before production use.

## Storage and migration rules

- Runtime queries use pooled `DATABASE_URL` through `db/index.ts`.
- Migration commands use direct `DATABASE_URL_UNPOOLED` through
  `db/drizzle.config.ts`.
- Change the Drizzle schema first, run `pnpm db:generate`, and commit SQL,
  snapshots, and journal together.
- Use `ensureScope()` before writes that create a workspace-owned record.
- Include workspace predicates on every read, update, and delete.
- Vault secrets are encrypted before Postgres storage; metadata and secret rows
  must never be returned together as plaintext.
- Browser image storage needs a private Blob store/token. Artifact reads are
  scoped and hash-checked.
- Local development uses Docker Compose Postgres and the generated random
  loopback port owned by `scripts/dev.mjs`.

## Command matrix

| Situation               | Command                      | Notes                                                                                 |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| First local setup       | `./init.sh`                  | Copies `.env.example` only when `.env.local` is absent, then delegates to `pnpm dev`. |
| Check prerequisites     | `./init.sh --check`          | Non-mutating Node 24, pnpm, Docker, and Compose check.                                |
| Install only            | `./init.sh --setup-only`     | Preserves `.env.local`; installs dependencies.                                        |
| Local app lifecycle     | `pnpm dev`                   | Starts Postgres, migrates, runs Next, and tears down the container on exit.           |
| App-only local run      | `pnpm dev:app`               | Use only with an externally managed database.                                         |
| Unit/integration tests  | `pnpm test`                  | Vitest suite; provider calls are mocked.                                              |
| Repository gate         | `pnpm check`                 | Lint, typecheck, tests, formatting, Knip, and boundaries.                             |
| Web build               | `pnpm build`                 | Next production build; does not itself provision infrastructure.                      |
| Eve production artifact | `pnpm build:eve`             | Required before a non-Vercel Eve service can start.                                   |
| Eve process             | `pnpm start:eve`             | Run under a supervisor with persistent `.eve` state when self-hosting.                |
| Vercel deployment       | `pnpm deploy` / `eve deploy` | Follow `docs/operations/VERCEL.md`; operator action.                                  |

## Change recipes

1. **Add a scoped data field:** update the owning schema, migration, service,
   schema validation, and service test. Include tenant predicates and FKs.
2. **Add an agent capability:** decide root versus worker ownership first,
   define a strict input/output schema, enforce authorization in code, then
   add a focused tool-boundary test.
3. **Add a connector:** prefer the existing registry/integration path, define
   environment validation and failure states, keep tokens out of chat/history,
   and add mocked contract tests.
4. **Change auth or routes:** test unauthenticated, authenticated, wrong-owner,
   and cross-origin cases. Test both Next proxy behavior and generated Eve routes.
5. **Change local startup:** preserve `scripts/dev.mjs` ownership of Compose,
   signal forwarding, dynamic port injection, migration, and teardown.

## Non-negotiable gates

Before handoff, run `pnpm check`, `pnpm build`, and `git diff --check`. For UI
changes, use a real local browser smoke after automated checks. For deployment
changes, prove one complete web-chat turn and one complete Linq turn; health
alone is insufficient. Do not claim production readiness from local tests.

## Common traps

- `@workflow/world-vercel` and Vercel Connect are not portable-provider support.
- Local phone code `000000` is a development bypass, not a Linq delivery test.
- The global configured Linq line is not a tenant model.
- Workspace columns without server-derived membership authorization are not true
  multi-tenancy.
- `BLOB_READ_WRITE_TOKEN` and `KERNEL_API_KEY` must never be printed or committed.
- In-memory channel state and local workflow state do not survive arbitrary
  process replacement without persistent backing storage.
- A successful typecheck does not prove Eve route rewrites, webhooks, or external
  provider credentials work.

## Bounded discovery checklist

1. Confirm the base SHA and clean worktree.
2. Read `AGENTS.md`, the relevant package docs, and the nearest tests.
3. Trace identity to `AccessScope` before touching data access.
4. Identify whether the change belongs to Next, Eve root, worker, service, or DB.
5. Search for an existing owning schema/type/service before adding one.
6. Add the smallest focused test, then run `pnpm check` and `pnpm build`.
7. Inspect the real rendered/runtime path when the change crosses a route or UI.
