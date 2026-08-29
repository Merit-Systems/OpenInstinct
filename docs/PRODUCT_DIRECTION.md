# Product direction: agent infrastructure first

Status: **proposed product decision**, not implemented.

## Recommendation

Build OpenInstinct first as an agent infrastructure service: a customer creates
a workspace, creates and configures an agent, attaches approved tools or MCP
connections, receives a managed phone line, and operates the agent through a
dashboard and versioned API. Add the consumer text-to-create experience later
as a product shell on the same control plane.

This sequencing preserves both ideas. The infrastructure product forces the
hard primitives—tenant isolation, agent versions, channel routing, connection
auth, approvals, usage, API keys, webhooks, and lifecycle—to become explicit.
The consumer product can then compose those primitives into a conversational
onboarding flow without becoming a separate architecture.

## The two paths

| Question              | Agent infrastructure service                          | Consumer text-to-create bot                                 |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Primary buyer         | Builder, operator, business, agency                   | Individual, organizer, group host                           |
| First interaction     | Dashboard/API signup                                  | Text a platform number                                      |
| Configuration         | UI plus API; versioned and reviewable                 | Conversational wizard                                       |
| Distribution          | API, webhook, dedicated line, embedded chat           | Share a number or invite into a group                       |
| Tool model            | Curated tools/MCP first; policy-controlled            | Templates with a narrow safe catalog                        |
| Main value            | Programmable agent infrastructure                     | Fast creation and social sharing                            |
| Hardest early problem | Secure tenant-configurable capabilities               | Identity, abuse, group ownership, moderation                |
| Current-code fit      | Stronger: manager, vault, tools, browser, scoped data | Weaker: no conversational provisioning or guest/group model |
| Recommended timing    | First                                                 | After the platform contracts are stable                     |

The consumer path may have better organic distribution, but it multiplies the
riskiest unresolved questions at once: who owns a bot created in a group, who
may reconfigure it, how guests consent to data retention and external actions,
how a number is recovered or transferred, and how abuse affects shared line
reputation. Those questions become easier when the underlying platform already
has explicit ownership and policy APIs.

## Product boundaries

Keep these concepts separate even if the first release gives every customer
exactly one of each:

- **Workspace**: customer, security tenant, billing account, quota, audit, and
  lifecycle boundary.
- **User**: authenticated human who may belong to one or more workspaces.
- **Agent**: configurable product resource owned by a workspace.
- **Agent revision**: immutable, publishable snapshot of instructions, model
  policy, enabled capabilities, and channel behavior.
- **Channel binding**: a phone line, web endpoint, or future chat surface routed
  to one agent. A new session pins that agent's active revision.
- **Participant**: an identity allowed to talk to an agent on a channel; this is
  distinct from a workspace member who can administer it.
- **Connection installation**: tenant-owned authorization and policy for an
  external MCP/API service.
- **Run/session**: durable conversation execution pinned to one workspace,
  agent, revision, channel, and initiating principal.

The invariant is:

```text
verified caller + verified channel binding
                  |
                  v
workspace -> agent -> published revision -> allowed capabilities
                  |
                  +-> session/run -> usage + audit + outbound events
```

Neither a prompt, a phone number in a request body, nor a model-generated tool
argument may select another workspace or agent.

## Infrastructure MVP

The narrow first release should support:

1. One owner signs up and receives one workspace.
2. The owner creates one agent draft and publishes immutable revisions.
3. The owner configures identity, instructions, model tier, and a curated set of
   tools/MCP integrations.
4. A phone line request enters a visible provisioning state. An operator or a
   pre-provisioned pool assigns a Linq line and binds it to the agent.
5. Approved participants can message the line; the owner can also use web chat.
6. The owner receives API credentials and can start sessions, send messages,
   read run status, and register signed webhook endpoints.
7. Every expensive or externally visible operation is subject to tenant policy,
   idempotency, quota, and audit.
8. Suspension stops new turns and side effects without deleting evidence.

Do not include arbitrary uploaded JavaScript, public anonymous agents, shared
workspace administration, marketplace billing, or instant self-serve number
creation in this first release.

## Control plane and runtime

Use one shared platform deployment initially, not one Vercel project per
customer. Per-customer Vercel projects would make rollout, migrations,
observability, incident response, and provider connector management scale with
tenant count. Isolation should come from authenticated workspace scope and
provider bindings, with dedicated deployments reserved for a later enterprise
tier when contract or residency requirements justify them.

```text
Dashboard / public API
         |
         v
Control plane ----------------------------------------------+
  workspace, memberships, agents, revisions, policy         |
  line requests, connections, API keys, webhooks, billing   |
         |                                                   |
         v                                                   |
Published runtime view                                      |
         |                                                   |
         v                                                   |
Inbound gateway -> tenant/agent resolver -> Eve session      |
  web/API          line + sender           dynamic context   |
                                              |              |
                                              +-> tools/MCP --+
                                              +-> Kernel
                                              +-> model
                                              +-> outbox -> customer webhooks
```

The control plane is application code and Postgres. Eve remains the durable
agent runtime. Its route auth should stamp verified `workspaceId`, `agentId`,
roles, and channel facts into the current principal. Eve dynamic instructions,
skills, tools, subagents, models, connection auth, and approval policies can
then resolve from that verified context. Eve does not supply a native tenant
object; membership, session ownership, lifecycle, and credential storage remain
application responsibilities.

## Proposed data model

Extend the existing `workspaces` and `workspace_memberships`; do not create a
parallel tenant table. Names below describe concepts, not approved migrations.

| Record                     | Required ownership and purpose                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `workspaces`               | Add display name, plan, lifecycle state, policy version, and timestamps                                     |
| `workspace_memberships`    | Add status and owner/admin/member roles with invitation provenance                                          |
| `agents`                   | Workspace-owned stable identity, slug, status, and active revision                                          |
| `agent_revisions`          | Immutable configuration manifest and publisher; never mutate a published row                                |
| `agent_capabilities`       | Revision-to-curated-tool/MCP bindings and least-privilege allow-lists                                       |
| `connection_installations` | Workspace/agent provider binding, auth owner, scopes, encrypted credential reference, and state             |
| `phone_line_requests`      | Requested, provisioning, assigned, failed, released lifecycle with provider reference                       |
| `phone_lines`              | Provider line identity, encrypted number plus lookup hash, connector, status, reputation, and agent binding |
| `channel_participants`     | Verified sender identity, role, invitation/consent state, and channel binding                               |
| `api_credentials`          | Hashed credential, visible prefix, workspace, scopes, expiration, and revocation                            |
| `webhook_endpoints`        | Workspace URL, encrypted signing secret, subscribed events, status, and rotation metadata                   |
| `webhook_deliveries`       | Event/endpoint attempt ledger, response class, retry time, and terminal state                               |
| `usage_events`             | Append-only model, browser, storage, message, and connection usage authority                                |
| `audit_events`             | Actor, workspace, agent, action, target, outcome, correlation ID, and redacted metadata                     |

Every agent-owned record must also carry `workspace_id`; relying on an indirect
join alone makes authorization and retention harder to prove. Use composite
foreign keys or equivalent constraints so an agent cannot reference a revision,
line, connection, or session from another workspace.

## Agent configuration and publishing

Treat customer configuration as data, not executable source:

1. Draft changes are validated against a versioned manifest schema.
2. Tool and connection references must resolve to an approved platform catalog.
3. Publish creates an immutable revision with a content digest.
4. New sessions pin the active revision; running sessions do not silently
   acquire a new capability set.
5. Rollback moves the active pointer to a previous compatible revision and is
   recorded in audit history.

A revision should contain presentation identity, authored instructions, model
policy, enabled skills, capability bindings, approval policy references, memory
policy, channel behavior, and limits. It should contain references to secrets,
never secret values.

## Tools and MCP strategy

“Let customers add tools” must not mean “execute customer JavaScript inside the
trusted application runtime.” Use a staged model:

### Stage 1: curated catalog

- Compile reviewed authored tools and MCP/OpenAPI connections with the app.
- Let each published agent enable a safe subset through Eve dynamic capability
  resolution.
- Resolve credentials from the verified workspace and user, never from a model
  argument.
- Apply explicit MCP operation allow-lists and tenant approval policy.
- Default writes, messages, purchases, deletes, and sensitive reads to approval.

### Stage 2: customer MCP endpoints through a broker

Current Eve dynamic capabilities cover tools, skills, instructions, subagents,
and models; connection files are authored/compiled resources. For arbitrary
customer MCP URLs, put a platform-controlled MCP broker behind one compiled
connection rather than generating source files or redeploying per tenant. The
broker should:

- validate Streamable HTTP/SSE transport and tool schemas;
- block private, loopback, link-local, metadata, and disallowed destinations;
- pin DNS/TLS policy and re-check redirects to prevent SSRF;
- keep credentials in tenant-scoped encrypted storage;
- cache discovery by installation/version and enforce allow-lists server-side;
- cap request/response sizes, timeouts, concurrency, and egress;
- attach tenant and call idempotency internally, never from model authority;
- audit discovery and every call without logging credentials or sensitive
  payloads.

The model should see only approved tool names, descriptions, schemas, and
bounded results. A tenant admin must review schema changes before newly added or
materially changed write tools become available.

## Phone-number provisioning

The current Linq Partner API documentation says adding or releasing phone
numbers is handled through Linq rather than a self-serve provisioning endpoint.
Therefore the initial product must choose one of these honest flows:

1. **Manual request:** signup creates `phone_line_request=requested`; operations
   obtains and assigns a line, then marks the agent ready.
2. **Pre-provisioned pool:** operations maintains an inventory of unused lines;
   signup atomically leases one while pool replenishment remains manual.
3. **Bring your own line:** a later customer connects an existing Linq account
   and line after an ownership challenge.

Do not show “your number is ready” until provider assignment, connector
attachment, trigger routing, status, contact policy, and a non-destructive
delivery check all pass.

Line state should distinguish `requested`, `provisioning`, `active`, `at_risk`,
`suspended`, `releasing`, `quarantined`, and `released`. Consume Linq
`phone_number.status_updated` events so `FLAGGED`, `AT_RISK`, or `CRITICAL`
reputation can stop or limit outbound traffic. Released numbers need a
quarantine and data-detachment procedure before reuse.

Using Vercel Connect, the connector trigger targets the Eve Linq channel. A
future direct Partner API adapter would own its own webhook subscription,
signing secret, signature verification, and retry deduplication. Do not run both
routes for the same line without a single routing owner.

## Public API proposal

Expose a platform API under `/v1`; do not expose raw database IDs or make the
framework-owned `/eve/v1/*` contract the long-term customer API.

| Endpoint                                                 | Purpose                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `POST /v1/agents`                                        | Create an agent draft in the authenticated workspace    |
| `GET /v1/agents/:agentId`                                | Read agent state and active revision                    |
| `POST /v1/agents/:agentId/revisions`                     | Validate and create a draft revision                    |
| `POST /v1/agents/:agentId/revisions/:revisionId/publish` | Publish an immutable revision                           |
| `POST /v1/agents/:agentId/line-requests`                 | Request a managed line asynchronously                   |
| `POST /v1/agents/:agentId/connections`                   | Configure an approved catalog/MCP installation          |
| `POST /v1/agents/:agentId/sessions`                      | Create a platform session pinned to the active revision |
| `POST /v1/sessions/:sessionId/messages`                  | Send a turn with idempotency                            |
| `GET /v1/sessions/:sessionId/events`                     | Stream normalized run events                            |
| `POST /v1/webhook-endpoints`                             | Register an outbound event destination                  |
| `GET /v1/usage`                                          | Read tenant usage and limits                            |

API credentials must be workspace-scoped, hashed at rest, shown once, and
limited by explicit scopes such as `agents:read`, `agents:write`,
`sessions:write`, `runs:read`, and `webhooks:write`. Require an
`Idempotency-Key` for resource creation, message delivery, and external actions.
Return stable error codes and request IDs; use cursors rather than exposing
database offsets.

## Customer webhooks

Use a durable outbox and at-least-once delivery. Each event needs a unique ID,
workspace and agent IDs, type, creation time, schema version, correlation ID,
and a data object. Sign the exact raw body with an endpoint-specific secret and
timestamp; reject replay outside the documented window. Customers deduplicate
by event ID.

Initial events:

- `agent.provisioning`, `agent.ready`, `agent.suspended`;
- `line.requested`, `line.active`, `line.status_updated`, `line.released`;
- `message.received`, `message.completed`, `message.failed`;
- `run.started`, `run.completed`, `run.failed`;
- `approval.required`, `approval.completed`;
- `connection.authorization_required`, `connection.connected`,
  `connection.revoked`;
- `usage.threshold_reached`.

Retry timeouts, network errors, `429`, and `5xx` with bounded exponential
backoff; treat other `4xx` responses as endpoint/operator failures. Store only a
redacted preview or digest of sensitive payloads in delivery logs. Provide
endpoint disable, secret rotation, test delivery, and replay-by-event controls.

## How the consumer product fits later

The text-to-create experience becomes another authenticated control-plane
client:

1. A platform onboarding number maps the verified sender to a personal
   workspace.
2. A constrained provisioning agent collects purpose, audience, name, and a
   template—not arbitrary executable instructions.
3. The control plane creates an agent draft, selects safe capabilities, and
   requests a line.
4. The owner confirms the published revision and sharing policy.
5. Guests receive a participant role on the channel, not workspace admin
   access.

Group bots then become channel bindings plus participant policy. Ownership,
configuration, billing, and deletion remain with the workspace owner. This
keeps a wedding, party, friend-group, or business bot on the same platform
instead of building a second tenancy model.

## Delivery phases and gates

1. **Tenant foundation:** explicit workspace membership, lifecycle, active
   scope, session ownership, usage, and audit. Gate: two-tenant isolation tests
   pass across DB, Eve, Kernel, Blob, vault, and routes.
2. **Agent resource:** agent/revision model, draft validation, publish and
   rollback. Gate: every session pins one workspace/agent/revision tuple.
3. **Curated capabilities:** tenant-resolved tools, MCP/OpenAPI catalog,
   credential ownership, and approval policy. Gate: wrong-tenant and schema
   drift tests fail closed.
4. **Managed lines:** line request/pool workflow, connector routing, participant
   policy, reputation state, and idempotent webhooks. Gate: one full inbound and
   outbound turn plus line suspension/retry tests.
5. **Platform API/webhooks:** scoped keys, idempotency, signed outbox delivery,
   usage and audit endpoints. Gate: replay, rotation, revocation, quota, and
   cross-tenant contract tests.
6. **Shared administration:** invitations and owner/admin/member capabilities.
   Gate: ownership transfer, removal, support access, and deletion rehearsal.
7. **Consumer shell:** text-to-create templates and guest/group participation.
   Gate: abuse, consent, recovery, moderation, and line reputation review.

## Decisions required before implementation

- Is the MVP customer a developer, an agency, or a small business operator?
- Is billing per workspace, agent, line, message, run, provider cost, or a
  bundled combination?
- Is one managed line included, wait-listed, or separately approved?
- Which curated tools/MCP services ship first, and which operations require
  approval?
- Can the first customer have multiple agents, even if the UI initially exposes
  one?
- Are connections owned by a workspace, an agent, or a user grant attached to
  an agent?
- What are the message, run, screenshot, audit, and released-line retention
  periods?
- What is the operator SLA for line provisioning, suspension, and connector
  failure?
- Which use cases or external actions are prohibited at launch?

## Sources used for this proposal

- Installed Eve 0.46.1 docs: dynamic capabilities, multi-tenant outbound auth,
  multi-tenant approvals, MCP connections, custom channels, route protection,
  security, and Vercel deployment.
- Current Linq Partner API docs: chat sending, webhook subscriptions and
  retries, line status/reputation events, and the non-self-serve phone-number
  provisioning constraint.
- Repository architecture and services described in
  [`ARCHITECTURE_REVIEW.md`](ARCHITECTURE_REVIEW.md).
