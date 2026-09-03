# Agent evals

The eval tree has two intentionally separate tiers:

- `agent/` is the behavioral regression suite for the root coordinator. It
  covers conversation quality, tool routing, safety boundaries, memory,
  personal information, and schedules.
- `browser/` is the slower end-to-end browser benchmark. It exercises real
  sites and records benchmark-specific timing, cost, and completion artifacts.

Directories are the grouping and filtering boundary. Each `.eval.ts` file owns
one behavior family, and array cases within a file share the same setup without
hiding their individual descriptions in the runner output.

## Running the suites

List every discovered case without making model calls:

```sh
pnpm eval:list
```

Run the root-agent suite locally, including soft judge thresholds as failures:

```sh
pnpm eval:agent
```

Run one family while iterating:

```sh
pnpm eval:agent --tag safety
pnpm eval:agent --tag routing
```

Produce JUnit output for CI:

```sh
pnpm eval:ci
```

The agent command loads `.env.local`, starts an isolated Docker Compose
PostgreSQL service, runs migrations, executes the suite, and then stops the
service. It requires `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`; the behavior
suite forces an unusable Kernel placeholder because browser work belongs in the
separate benchmark. Agent cases run serially so memory cases cannot leak state
into a concurrently executing case, and memory cases remove their canaries.
Judge-backed cases use the judge model in `evals.config.ts`. Full
event streams and assertion details are written to `.eve/evals/`.

Run the browser benchmark separately because it uses Kernel, real websites,
and a longer completion loop:

```sh
pnpm bench:browser
```

See `browser/README.md` for benchmark suites, repetitions, A/B runs, and its
dashboard.

## What should be a gate

Use deterministic gates for observable contracts: the selected tool, a pending
approval, an absent secret canary, a required delivery, or a worker boundary.
Use the judge only for qualities that cannot be expressed safely as an exact
match, such as decisiveness, concise wording, or whether a free-form answer
actually satisfies the request. Judge thresholds are soft in Eve, so run this
suite with `--strict` when regressions should fail the command.

When a production failure appears, add the smallest sanitized reproduction to
the owning family. Add a new family only when it represents a genuinely new
contract. Avoid examples that can send, purchase, delete, or otherwise mutate
external state; approval evals should stop while the action is still pending.
