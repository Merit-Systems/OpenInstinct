# Knowledge memory

Knowledge memory adds evidence-backed records, revision history, linked Markdown,
and background maintenance to the existing Personal Info and workstream memories.
It is experimental and **off by default**. It adds no dependencies.

The design was inspired by [Dhravya Shah's article about Instinct's memory](https://x.com/dhravyashah/status/2101745550752428340).
That article is an outside-in reconstruction of a closed product. This is an
independent implementation for OpenInstinct, not Instinct's source or a claim of
equivalent behavior. It uses PostgreSQL and private Blob, not a Git repository
containing personal information.

## Enable and inspect

Apply the committed migrations with `pnpm db:migrate`, then configure:

```dotenv
KNOWLEDGE_MEMORY_MODE=shadow
# Optional: comma-separated authenticated workspace IDs. Omit for all workspaces.
KNOWLEDGE_MEMORY_WORKSPACES=personal:your-workspace-id
# Daily limits per workspace, shared across its memory scopes (UTC).
KNOWLEDGE_MEMORY_DAILY_TOKENS=250000
KNOWLEDGE_MEMORY_DAILY_CALLS=100
```

- `off`: preserves legacy behavior for workspaces that have not migrated. No new
  knowledge capture or model maintenance runs.
- `shadow`: captures and compiles knowledge, and exposes the Memory page for
  inspection. Existing profile recall remains active; knowledge is not supplied
  to the answering agent. Maintenance uses the workspace's configured model.
- `enabled`: adds knowledge recall, search, evidence/history inspection and
  explicit remember/correct/forget tools. The Memory page offers the same controls
  and JSON/Markdown exports.

Blank environment values are treated as unset; a comma-only allowlist permits no
workspaces. The default is `off`; setting only an allowlist does not enable the
feature. Change deployment configuration and
start fresh chats when changing modes. Feature activation does not grant browser,
payment, messaging or other action permissions.

Open a chat before using the Memory page. Eve supplies the environment-scoped
memory key, which the server binds to that owned chat. The UI selects an owned
chat; it cannot supply a workspace or memory key. Personal Info continues to own
reusable form fields, and workstreams continue to own tasks and their active
index. Browser subagents do not inherit the knowledge store.

## Data flow

1. The memory lifecycle binds the owned chat; the root hook collects eligible user
   input from timestamped message receipts before model tools execute.
   A restricted, authenticated maintenance route repairs missed capture from
   bounded pages of owned session streams. Inserts and cursor advancement commit
   together. Capture starts at the chat's first knowledge binding; earlier chat
   history is skipped. Original receipt timestamps survive retries and forgetting.
   Recalled context, model reasoning and assistant claims are excluded.
2. A minutely Eve schedule claims durable PostgreSQL jobs. A restricted structured
   model call proposes exact source quotations; server code validates sources,
   offsets, revisions, ownership and deletion state before publishing anything.
   Relevant existing records are selected from source text under a bounded
   context budget.
   Authentication and input-request events disable capture for that chat. This
   conservative boundary includes ordinary clarification requests: subsequently,
   save or correct facts in a fresh chat or on the Memory page. Obvious credentials
   and explicitly excluded input are rejected earlier.
   Pattern checks supplement those typed boundaries; they are not a universal
   secret detector.
   Disabling capture revokes evidence from the requesting turn and any inputs
   received at or after that request, along with records derived from that
   evidence. Earlier independent memories survive; Memory-page edits remain
   separate. Recovery applies the original request boundary even when capture
   is already disabled.
   At the end of a turn, unused explicit-control inputs are discarded unless a
   saved record or revision cites them. Recovery also repairs missed cleanup.
3. Records and revisions are authoritative in PostgreSQL. Explicit edits publish
   immediately. Background publication uses leases, checkpoints, source versions
   and deletion epochs. Private immutable Markdown uploads have a reservation
   ledger, so abandoned uploads can be collected. Storage failures do not expose
   partial generations.
4. Recall supplies a bounded profile/current-context bundle and selected records.
   Each projection fits 6,000 UTF-8 bytes after JSON escaping; the complete
   knowledge recall message, including instructions, fits 17,500 bytes. Whole
   records that do not fit are skipped, leaving room for smaller candidates.
   These are byte limits, not exact model-token counts; other memory providers
   and the conversation have separate context costs.
   Search, read, one-hop links and history return scoped evidence. Stable recall
   IDs replace old bundles even when empty. Operation receipts preserve exact
   replay; erased receipts reject replay and require a new turn.

Each record represents one supported claim. Markdown snapshots contain its
revision, evidence spans and logical record links; the current profile and context
are deterministic database projections. The existing workstream provider supplies
the task index separately, without duplicating task state in knowledge memory.

The initial extractor deliberately favors precision: English first-person
statements, exact quotes, conservative corrections and source-supported
co-mentions. It does not infer personality, merge people by name, parse relative
dates into facts, broadly backfill old chats, or ingest arbitrary browser content.
Temporal fields and expiry filtering are available in the record contract;
automatic temporal interpretation is not part of this release. No embedding or
graph service is required.

## Corrections, deletion and migration

Edits require the expected revision and an operation ID. A correction is visible
on the next recall; it does not wait for scheduled compilation. Autonomous jobs
cannot overwrite explicit user records. Normal history retains previous versions.

Forgetting removes the selected record, its revisions, supporting sources,
dependent records sharing those sources, links, generated summaries and cached
recall payloads. Non-content tombstones and a deletion cutoff prevent retries,
stale workers and old stream recovery from restoring it. Private artifacts are
revoked immediately and physically deleted by retryable housekeeping, which
continues after the feature is switched off. Cleanup waits at least five minutes
after upload reservation to cover an upload that was already in flight. New
explicit input can create a new
record. Downloaded exports, original chats, text already sent to a model and
provider backups are outside this saved-memory deletion boundary.

Enabled workspaces import the existing scoped profile once, labelling its
original source/date as unknown. The old document is cleared only after the
import transaction commits; a durable migration marker prevents re-import after
forgetting or rollback. A first chat may need another turn while the trusted
binding and migration become available. Switching off after migration disables
knowledge recall rather than restoring an obsolete legacy copy. Re-enable the
feature to inspect or manage migrated records. Do not restore old memory tables
or Blob snapshots independently of deletion state. Roll back with the feature
flag while keeping the migration-aware code deployed. Drain sessions running an
older deployment before enabling cutover.

## Usage budgets and operation

Daily extraction defaults are 250,000 charged tokens and 100 model calls per
workspace, shared across its memory scopes. Either limit set to zero pauses
model extraction. A transaction reserves capacity before every call, including
retries, so concurrent workers cannot independently spend the same allowance.
The UTC date at reservation determines the accounting day, even if a call
finishes after midnight.

The reservation uses the UTF-8 byte length of the instructions, prompt and output
schema, plus the 3,000-token output limit and a 1,024-token framing allowance.
This is a conservative admission estimate, not a tokenizer or a dollar cap.
Reported provider usage replaces the reservation once, including failed calls
with complete usage. Missing or partial usage, timeouts without complete usage
and abandoned calls retain at least the reservation. Reported overruns
are charged and block subsequent admission. Provider billing can therefore exceed
the estimate; this is not a guarantee of an exact spending ceiling.

Exhausted budgets defer extraction until the next UTC day without consuming a
retry. A request larger than an entire positive daily token allowance is rejected
without a model call: its unsupported pending text is discarded, a failure marker
prevents replay, and later inputs can proceed. Explicitly saved evidence survives.
The original chat remains outside this cleanup. Zero budgets preserve queued
input. Raising a limit takes effect for new claims; already deferred extraction
remains scheduled for its recorded retry time.

Explicit edits, legacy import, export publication, forgetting and artifact purge
do not need extraction budget. An explicit change wakes deferred work to publish
its export. The non-content usage ledger retains model IDs, attempts, reported
usage and accepted-proposal counts after a record is forgotten; deleting the
workspace removes it. It never stores prompts, source text or model output.

The authenticated `memory.status` query accepts an owned `sessionId`, like the
other memory queries. It returns scoped source/job/artifact counts and oldest
timestamps, the latest generation time, and workspace-wide daily usage. Usage
includes outstanding reservations, unknown charges, retry costs and calls that
accepted no proposals. Those counts are operational evidence, not answer-quality
scores. Monitor pending/dead-letter jobs, queue age and artifact purge backlog.
Hosting cadence and model availability determine automatic capture freshness;
the system does not promise a fixed publication latency or exactly-once billing.

## Validation

```bash
pnpm check
pnpm build
pnpm test:runtime
pnpm bench:memory:scenarios
pnpm bench:memory:scale
# Requires AI Gateway credentials; uses fresh sessions and semantic grading.
KNOWLEDGE_MEMORY_MODE=enabled pnpm eval:agent --tag knowledge-memory
```

The deterministic suites exercise scoped remember → correct → recall → forget,
source validation, revision conflicts, source recovery, replay, migration,
deletion fencing and failed publication. The scenario runner executes 40 frozen
evidence gates three times in isolated database state and writes a JSON report to
`.eve/benchmarks/memory-scenarios.json` (override with `--output path`). Model
extraction, Blob and recovery HTTP boundaries use fixtures. Semantic answer quality
and a live-model comparison with the pinned legacy baseline remain unmeasured;
unsupported baseline APIs are reported separately from shared behavior not run.

The opt-in scale runner uses three fresh PGlite processes with 1,000 synthetic
records, multilingual text, older relevant records and one-hop links. It records
first-call latency and 30 warm samples per operation, p50/p95, serialized bytes,
source hashes and runtime metadata under `.eve/memory-scale` (override with one
output-directory argument). It exercises the installed Eve file-memory provider
as a constrained baseline, recording its entry/document limits rather than
silently shrinking a dataset and calling the results equivalent. Local database
timings do not establish hosted PostgreSQL, network or model latency.

Two opt-in live evaluations repeat the explicit remember/correct/recall/forget
flow and the automatic capture/maintenance/fresh-session recall flow three times
each. They wait for observed publication, use isolated scenarios and clean up
their saved records. Run them with configured credentials before expanding
rollout. Passing deterministic checks is not a measurement of model recall quality.

After the live evaluation workers stop, the supervisor cleans only their
synthetic workspace's artifact ledger before deleting the disposable database.
Cleanup respects the five-minute reservation grace. If cleanup fails or the run
is interrupted after migration, the database and volume are retained with a
retry command so the purge ledger is not lost. This may add several minutes to
live evaluation teardown; it does not validate hosted storage until actually run.

Maintenance also has batch, timeout, output and retry bounds. Processed inputs
without supported claims are cleared. Inputs that exhaust retries discard their
text and checkpoint while retaining a non-content marker, allowing newer inputs
to proceed.
