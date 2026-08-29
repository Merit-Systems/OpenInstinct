# Plan 001: Define Vercel-first multi-tenancy and make onboarding repeatable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report instead of improvising. The reviewer
> who dispatched this plan owns `plans/README.md`; do not edit the plan files.
>
> **Drift check (run first)**:
> `git diff --stat 480045dbc63008e7f99313d1683858cd8657b35a..HEAD -- README.md AGENTS.md .env.example init.sh tests docs`
> If an in-scope file changed since this plan was written, compare the current
> state below against the live code. Treat a material mismatch as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs, DX, direction
- **Planned at**: commit `480045d`, 2026-08-29

## Why this matters

The repository has strong security and ownership boundaries but no durable
architecture map, Vercel operator runbook, or one-command onboarding entrypoint.
Agents currently have to rediscover how Next.js, Eve, Better Auth, PostgreSQL,
Kernel, Vercel Connect, Blob, and Linq fit together. The primary product
direction is now true multi-tenancy on Vercel. Hetzner, Railway, and portable
provider credentials are explicitly out of scope for this phase.

## Current state

- `next.config.ts:1-6` wraps the single Next.js application with `withEve`.
- `agent/agent.ts:5-22` owns the root Eve agent; `agent/subagents/worker/`
  owns the browser-execution worker and its flat tool surface.
- `agent/channels/eve.ts:7-32` authenticates web sessions and enforces session
  ownership. `agent/channels/linq.ts:76-87` obtains Linq credentials through
  Vercel Connect.
- `lib/access-scope.ts:19-29` derives one deterministic personal workspace per
  principal. `db/schema/application.ts:14-245` already anchors application
  records to a workspace, but memberships only admit the `owner` role.
- `compose.yaml:1-18` runs PostgreSQL 17 locally. `scripts/dev.mjs:129-160`
  starts it, discovers the random loopback port, migrates, starts Next, and
  tears Compose down without deleting its volume.
- `package.json` requires Node 24 and pnpm 11.24.0. The repository contract
  requires `pnpm check` and `pnpm build` before handoff.
- Eve 0.46.1 links and deploys this application through its Vercel deployment
  commands, while the repository's Linq and Google paths use Vercel Connect.
- The original Linq sample at `https://github.com/linq-team/ai-agent-example`
  uses a direct partner API token. Treat it as an integration reference, not
  as this repository's Vercel runtime contract.

Repository conventions:

- Keep TypeScript concepts anchored to one source of truth; do not mirror
  schema or SDK types.
- Keep browser execution only under `agent/subagents/worker/tools` and share
  Kernel through `lib/kernel.ts`.
- Do not put credentials, real phone numbers, tokens, host IPs, or generated
  secret values into source or documentation.
- Documentation must distinguish current behavior, recommended direction,
  future work, and unverified assumptions.

## Commands you will need

| Purpose          | Command                                     | Expected on success |
| ---------------- | ------------------------------------------- | ------------------- |
| Install          | `pnpm install --frozen-lockfile`            | exit 0              |
| Narrow tests     | `pnpm vitest run tests/init-script.test.ts` | all tests pass      |
| Full check       | `pnpm check`                                | exit 0, no warnings |
| Production build | `pnpm build`                                | exit 0              |

## Reference docs

- Exact Eve 0.46.1 package docs: `docs/README.md`, the Vercel deployment guide,
  and `docs/channels/linq.mdx` from the installed `eve` package. If dependencies
  are not installed, use the same files from the `eve@0.46.1` npm package.
- Linq webhooks: `https://docs.linqapp.com/guides/webhooks/` and
  `https://docs.linqapp.com/guides/webhooks/subscriptions/`.
- Vercel CLI and Connect documentation, resolved through Context7.
- Better Auth organization documentation, resolved through Context7, as a
  candidate design reference rather than an adopted dependency.

## Scope

**In scope** (the only files the executor may create or modify):

- `README.md`
- `AGENTS.md`
- `init.sh` (create)
- `tests/init-script.test.ts` (create)
- `docs/ARCHITECTURE_REVIEW.md` (create)
- `docs/AGENT_GUIDE.md` (create)
- `docs/MULTITENANCY.md` (create)
- `docs/operations/VERCEL.md` (create)

**Out of scope**:

- All production TypeScript, database schema, migrations, and UI code.
- Linq portable-credential implementation.
- A live Vercel, Linq, database, DNS, or webhook mutation.
- Hetzner, Railway, or portable provider deployment guidance.
- Dockerfiles, production Compose manifests, systemd units, or Terraform.
- Any claim that the software is production-ready.

## Git workflow

- Work only in `/tmp/fork-openinstinct-hetzner.Hlj0FA` on branch
  `codex/vercel-multitenant-architecture`.
- Do not push, open a PR, create infrastructure, or commit. The reviewer owns
  final verification and commit.

## Steps

### Step 1: Add a regression-tested local bootstrap

Create executable `init.sh` as a thin, idempotent wrapper around the existing
owned lifecycle in `scripts/dev.mjs`:

- POSIX-compatible Bash with `set -euo pipefail`.
- Resolve repository root from the script location and run there.
- Support `--help`, `--check`, `--setup-only`, and `--skip-install`; reject
  unknown flags with exit code 2.
- Check Node major 24, pnpm, Docker, and `docker compose`. `--check` performs
  checks only and must not create files, install packages, or start services.
- Preserve an existing `.env.local`. If absent outside `--check`, copy
  `.env.example`, set mode 0600, and stop with an actionable instruction to set
  `KERNEL_API_KEY`; do not generate, echo, parse with `source`, or overwrite
  secrets.
- Install with `pnpm install --frozen-lockfile` unless `--skip-install` is set.
- `--setup-only` exits after setup. The default ends with `exec pnpm dev`,
  delegating PostgreSQL, migrations, process signals, and teardown to the
  already-tested supervisor.
- Explain in terminal copy that localhost phone auth uses the development-only
  code `000000`; this is not a real Linq round trip.

Create `tests/init-script.test.ts` using temporary directories and fake
executables, following `tests/local-development.test.ts` for subprocess test
style. Cover at least: help/check are non-mutating, missing env template copy
and mode, existing `.env.local` preservation, setup-only install, skip-install,
default `pnpm dev`, missing/wrong prerequisites, and unknown flags.

**Verify**: `pnpm vitest run tests/init-script.test.ts` → all new tests pass.

### Step 2: Write the architecture review

Create `docs/ARCHITECTURE_REVIEW.md` with:

- review scope and base SHA;
- a concise topology and request/data-flow diagram;
- subsystem ownership table with exact file paths;
- persistence, secrets, trust boundaries, deployment assumptions, and test
  strategy;
- a vetted findings table with impact, effort, risk, confidence, and evidence;
- explicitly considered/rejected findings;
- current limitations: Vercel coupling, local-only phone bypass, global Linq
  line, external Kernel, Blob requirement for browser artifacts, self-hosted
  workflow persistence, and non-production warning.

Do not present future recommendations as implemented behavior.

**Verify**: every backticked repository path in the document exists.

### Step 3: Write the agent repository guide

Create `docs/AGENT_GUIDE.md` as the fast orientation for future agents:

- what the product is and the Eve/Next runtime mental model;
- route map (`/`, `/chat`, `/eve/v1/*`, auth, tRPC, artifacts);
- directory ownership and dependency direction;
- identity → principal → workspace → session flow;
- browser-worker delegation and Kernel boundaries;
- database migration and storage rules;
- local/prod command matrix;
- change recipes and non-negotiable verification gates;
- common traps and a bounded discovery checklist.

Add a short pointer to this guide in `AGENTS.md`, preserving all existing
instructions.

**Verify**: `rg -n 'AGENT_GUIDE|pnpm check|pnpm build' AGENTS.md docs/AGENT_GUIDE.md`
→ matches all three concepts.

### Step 4: Define true multi-tenancy on Vercel

Create `docs/MULTITENANCY.md`. Make Vercel the recommended first production
platform and define, without implementing:

- explicit tenant/workspace domain model, memberships, roles, invitations,
  active workspace selection, and lifecycle;
- request-scope invariant: tenant identity is resolved server-side from an
  authenticated membership, never trusted from a client-supplied workspace ID;
- composite foreign keys/service boundaries and optional PostgreSQL RLS as
  defense in depth;
- mapping of Better Auth users, Eve principals/sessions, Linq sender/line,
  Google authorization installations, Vercel Connect installation IDs, Blob
  object prefixes, Kernel browsers, and usage ledger to a tenant;
- per-tenant secrets/connection references, quotas, billing, audit events,
  deletion/export, retention, abuse controls, observability, and support tools;
- one-line versus bring-your-own-line Linq product decisions and their tradeoffs;
- horizontal scaling risks, especially in-memory channel adapter state and
  local workflow state;
- staged migration with machine-checkable gates, rollback boundaries, and a
  threat-model checklist;
- current-state/gap/target tables and explicit open product decisions.

Do not imply that workspace columns alone equal multi-tenancy.

**Verify**: the document contains explicit sections for isolation, identity,
channels/connections, billing/quotas, lifecycle, migration, tests, and open
decisions.

### Step 5: Write the Vercel multi-tenant runbook

Create `docs/operations/VERCEL.md` with preflight, initial provisioning,
environment/connector setup, migration/deploy, tenant bootstrap, verification,
operations, rollback, backup/restore, incident response, and teardown sections.

The runbook must preserve the repository's existing Eve-native deployment flow
(`eve link` and `eve deploy` where applicable), Neon pooled/direct URLs, private
Blob, Kernel, AI Gateway, Linq triggers at `/eve/v1/linq`, and Google Connect
setup. Explain environment scoping and how connector installations, phone/line
routing, and OAuth grants will map to tenants. Every mutating command must use
obvious placeholders and be labeled as an operator action. Include a
tenant-isolation acceptance checklist and require one complete web-chat and
Linq turn, not health alone.

**Verify**: the document contains no token-like strings or personal phone
numbers and includes `/eve/v1/health`, `/eve/v1/linq`, migration, rollback,
tenant isolation, and restore rehearsal.

### Step 6: Link the documentation

Add a compact README section linking the five new documents and `init.sh`.
Preserve the existing one-click Vercel and local-development guidance.

**Verify**: `rg -n 'ARCHITECTURE_REVIEW|AGENT_GUIDE|MULTITENANCY|VERCEL|init.sh' README.md`
→ every artifact is linked.

### Step 7: Run repository gates

Run the narrow test, then the repository contract.

**Verify**:

1. `pnpm vitest run tests/init-script.test.ts` exits 0.
2. `pnpm check` exits 0 with no warnings.
3. `pnpm build` exits 0.
4. `git diff --check` exits 0.
5. `git status --short` lists only files from the in-scope list.

## Test plan

- `tests/init-script.test.ts` owns subprocess behavior and filesystem effects.
- Model its fake-command harness after `tests/local-development.test.ts`.
- Do not require real Docker, network, secrets, or a live dev server in unit
  tests.
- The reviewer will perform one real local smoke after all automated gates.

## Done criteria

- [x] `init.sh --check` is non-mutating and deterministic.
- [x] Default `init.sh` delegates the existing full local lifecycle to
      `pnpm dev` and never overwrites secrets.
- [x] All four documents exist, distinguish current from future behavior, and
      contain no credentials or personal data.
- [x] Vercel-first multi-tenancy is the primary recommendation; non-Vercel
      hosting is explicitly outside this phase.
- [x] `pnpm check`, `pnpm build`, and `git diff --check` exit 0.
- [x] No file outside the in-scope list is modified.

## STOP conditions

Stop and report if:

- the base code differs materially from the current-state evidence;
- accurate documentation would require a production code/schema change;
- a test requires printing, committing, or sourcing a real secret;
- the app cannot build through the existing `pnpm build` contract;
- an in-scope change would contradict the repository's Eve or Next docs;
- a verification fails twice after one reasonable correction.

## Maintenance notes

- Portable Linq credentials, durable non-Vercel profile/browser storage, and a
  tenant data model are intentionally follow-up implementation plans.
- Reviewers should scrutinize every statement phrased as current behavior and
  ensure it has source evidence.
- Revisit the portability recommendation only after measuring matched workload
  cost and operational burden with equivalent functionality and tenant success.
