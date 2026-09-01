# Upstream sync policy

This fork ships a production product. Upstream (`Merit-Systems/OpenInstinct`)
is our feature pipeline. This file is the contract for staying current.

## Remotes

- `origin`: dennisonbertram/fork-OpenInstinct (production, protected by the
  full harness).
- `upstream`: https://github.com/Merit-Systems/OpenInstinct.git

## Cadence

Sync weekly, or when the drift watch reports meaningful commits. Small weekly
merges are the goal; do not let another 81-commit cliff build up.

## Procedure

1. Branch `sync/upstream-YYYYMMDD` from `main`. `git fetch upstream`.
2. Merge upstream merge-commits chunk by chunk (first-parent order), never
   rebase published history. Resolve with the standing rule: **upstream's
   structure, our functionality** — both intents merged in content conflicts.
3. Gate EVERY chunk: `pnpm check`, synthetic-env `pnpm build`, and
   `pnpm test:e2e` (7 specs, enforce posture). Do not pipe test output through
   `tail`/`grep` in a `&&` chain — pipes mask exit codes.
4. Clear `.next` before dev-server boots after any merge that moves files;
   stale dev caches silently disable `src/proxy.ts` (observed 2026-09-01).
5. Preview deploy before merging the PR; production deploys on merge and runs
   migrations first.

## Migration numbering (permanent rule)

Fork migrations are applied in production and are **never renamed**. Upstream
migrations adopt the next free fork numbers, journal entries appended,
snapshots chained; upstream "replay" migrations that duplicate already-adopted
DDL are skipped. After renumbering: `pnpm db:check` clean and a second
`pnpm db:generate` must report no changes. History so far: upstream
0004/0005 -> fork 0013 (browser traces); upstream 0006 user_profiles ->
fork 0014 (replay portion skipped).

## Fork-owned surfaces (expect conflicts here)

`src/lib/{admin,agent-manifest}.ts`, `src/lib/api/v1-auth.ts`,
`src/app/(authenticated)/admin/**`, `src/app/v1/**`, `src/app/api/cron/**`,
`src/proxy.ts` exclusions (`/v1/`, `/api/cron/`), enforcement wiring in
`src/lib/request-scope.ts` + channels, `db/services/*` (multitenancy),
fork migrations 0004-0012, `tests/integration/**`, `tests/e2e/**`, and the
fork sections of `src/trpc/router.ts`, `src/lib/env.ts`, AGENTS.md.

## Fork policy overrides (re-assert after every sync)

- evlog: `redact: true`, `message: "omit"` (agent/hooks/evlog.ts) — tenant
  content never reaches logs; pinned by tests/agent/hooks/evlog.test.ts.
- `WORKSPACE_SCOPE_ENFORCEMENT=enforce` posture in the Playwright webServer.
- No hand-edits to pnpm-lock.yaml (minimumReleaseAge policy); resolve
  package.json, then regenerate with `pnpm install`.

## Drift watch

`.github/workflows/upstream-drift.yml` runs weekly: fetches upstream, and if
new commits exist, opens/updates the "Upstream drift" issue with the list.
