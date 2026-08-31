# Browser benchmarks

The benchmark grades the user's end goal with an independent LLM judge. Tool
choice and click sequences are diagnostic data, never pass conditions.

Run the high-level public-demo suite against the dev server:

```sh
BROWSER_BENCH_LABEL=baseline BROWSER_BENCH_SUITE=smoke pnpm bench:browser
```

Use repeated trials when making a speed decision (the default is one to avoid
surprise spend):

```sh
BROWSER_BENCH_LABEL=baseline BROWSER_BENCH_REPETITIONS=3 pnpm bench:browser
```

The live suite contains real public booking and purchase-boundary tasks across
movie tickets, restaurants, rail, hotels, and retail. Every task stops before
the irreversible confirmation:

```sh
BROWSER_BENCH_SUITE=live pnpm bench:browser
```

The profile suite contains tasks that require an existing signed-in browser,
such as preparing the user's last-purchased soap on Amazon without buying it:

```sh
BROWSER_BENCH_SUITE=profile pnpm bench:browser
```

Set `BROWSER_BENCH_SCOPE_PRINCIPAL` for the profile suite. Its value is the same
stable access-scope principal used by the signed-in application user; the
runner does not write it to an artifact. The `all` suite includes smoke, live,
and profile tasks.

Target a deployment with the same suite:

```sh
BROWSER_BENCH_LABEL=baseline pnpm bench:browser --url https://your-deployment.example
```

The terminal table reports each completed task's success, agent duration, LLM
cost, and terminal message. Full results are written to
`.eve/browser-benchmarks/`; `latest.json` always points to the newest run.

Before changing the agent, preserve the baseline, then compare it with a new
run:

```sh
cp .eve/browser-benchmarks/latest.json .eve/browser-benchmarks/baseline.json
BROWSER_BENCH_LABEL=no-fixed-waits pnpm bench:browser
pnpm bench:compare .eve/browser-benchmarks/baseline.json .eve/browser-benchmarks/latest.json
```

Edit `src/lib/browser/benchmark-tasks.ts` to add a small number of stable,
intent-level tasks. Every case declares the user's prompt and a goal-level
success rubric. The judge sees the task, worker result, and coordinator response;
a plausible but incomplete answer does not count. Agent time is measured from durable
`message.received` to the terminal `message.completed` event. LLM cost sums
`usage.costUsd` from every completed model step; a `~` prefix means at least one
step did not report cost.

## Two-revision A/B

Start the standalone local dashboard in its own terminal. It only reads the
latest status artifact and never starts, stops, or times out benchmark runs:

```sh
pnpm bench:dashboard
```

Open `https://eve-browser-bench.localhost`, then run an A/B suite from another
terminal. The dashboard updates as Eve schedules tasks, discovers root and
worker sessions, and records judged results, cost, duration, and tool counts.
The run index keeps completed and interrupted comparisons available, with a
table view for each run's task-level results.

The A/B runner checks out two revisions into temporary worktrees, starts an
isolated database and Portless Eve server for each, runs both revisions
concurrently against the same task array, compares the artifacts, then cleans
up:

```sh
pnpm bench:ab <baseline-ref> <candidate-ref> --suite all --label "semantic browser loop"
```

Runs default to nine concurrent tasks per revision, so an A/B suite can execute
up to 18 tasks at once. Real flows default to a 15-minute per-task timeout. Use
`--task-timeout-minutes <n>` to change that budget, `--repetitions 3` for a less
noisy speed decision, `--max-concurrency <n>` to override parallelism, and
`--keep` to leave both Portless instances and worktrees running for inspection.
`--label "…"` records a short note in the run list and detail view. Combined
artifacts land under `.eve/browser-ab/<timestamp>/`.
