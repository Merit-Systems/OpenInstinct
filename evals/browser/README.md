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

The live suite contains real, profile-dependent purchase-boundary tasks such as
finding movie tickets for tonight and preparing the user's last-purchased soap
on Amazon without buying either item:

```sh
BROWSER_BENCH_SUITE=live pnpm bench:browser
```

Set `BROWSER_BENCH_SCOPE_PRINCIPAL` when the live suite must use an existing
workspace browser profile. Its value is the same stable access-scope principal
used by the signed-in application user; the runner does not write it to an
artifact.

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

The A/B runner checks out two revisions into temporary worktrees, starts an
isolated database and Portless Eve server for each, runs the same task array
against both, compares the artifacts, then cleans up:

```sh
pnpm bench:ab <baseline-ref> <candidate-ref> --suite smoke
```

Use `--repetitions 3` for a less noisy speed decision, `--max-concurrency 2` to
trade isolation for runtime, and `--keep` to leave both Portless instances and
worktrees running for inspection. Combined artifacts land under
`.eve/browser-ab/<timestamp>/`.
