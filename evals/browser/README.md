# Browser benchmark

Run the editable browser task suite concurrently against the dev server:

```sh
BROWSER_BENCH_LABEL=baseline pnpm bench:browser
```

Use repeated trials when making a speed decision (the default is one to avoid
surprise spend):

```sh
BROWSER_BENCH_LABEL=baseline BROWSER_BENCH_REPETITIONS=3 pnpm bench:browser
```

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
interaction-focused tasks shared by the CLI and home-page runner. Every case
declares deterministic reply fragments and the semantic worker tools that must
complete. A plausible answer without the expected browser trajectory does not
count. Agent time is measured from durable
`message.received` to the terminal `message.completed` event. LLM cost sums
`usage.costUsd` from every completed model step; a `~` prefix means at least
one step did not report cost.
