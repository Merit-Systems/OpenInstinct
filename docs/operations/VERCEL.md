# OpenInstinct local and Vercel operator runbook

This is the supported deployment path for the current repository. It is an
operator procedure, not a production-readiness claim. Hetzner, Railway, and
portable provider credentials are outside this runbook.

It covers four outcomes:

1. start the complete application locally with disposable Postgres;
2. provision and deploy a new Vercel environment;
3. attach Linq without exposing credentials or accidentally enabling preview
   messaging;
4. verify, operate, roll back, and recover the deployment.

The current product has one deployment-level Linq line. The proposed
multi-tenant product deliberately uses a shared platform number with durable
conversation-to-workspace/agent routing; optional dedicated lines are a later
premium channel. That resolver, agent, API, and webhook design is proposed in
[`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md); it is not implemented by
this runbook.

## Verified reference deployment

The following non-secret state was rechecked on 2026-08-29. Treat it as a
known-good reference, not an eternal assertion:

| Item               | Verified value                                           |
| ------------------ | -------------------------------------------------------- |
| Vercel team        | `dennisons-projects`                                     |
| Project            | `open-instinct`                                          |
| Canonical URL      | `https://open-instinct-ashy.vercel.app`                  |
| Deployment         | `dpl_AQTYRYy3Sf7dgFchPg3qkH1R1GqQ` (`Ready`, production) |
| Git revision       | `3dd89d72295deb0f775db64668dbbac9b26e1867`               |
| Neon resource      | `open-instinct-db`                                       |
| Kernel resource    | `open-instinct-browser`                                  |
| Private Blob store | `open-instinct-private`                                  |
| Linq connector UID | `linq/open-instinct-line`                                |
| Linq trigger       | `/eve/v1/linq`                                           |

The health endpoint returned `200` with Eve status `ready`, the sign-in page
rendered the phone form, the connector existed in the Vercel Connect registry,
and Vercel reported no recent error logs. No live OTP/message is implied by
those checks.

Quick non-destructive recheck:

```bash
curl --fail --silent --show-error \
  https://open-instinct-ashy.vercel.app/eve/v1/health
pnpm exec vercel inspect https://open-instinct-ashy.vercel.app
pnpm exec vercel logs open-instinct-ashy.vercel.app \
  --since 30m --level error --no-follow
pnpm exec vercel connect list --json
```

## Local zero-to-running

### Local prerequisites

- macOS or Linux with a POSIX shell;
- Node 24;
- pnpm 11.24.0 through Corepack or an equivalent pinned install;
- Docker with Compose v2 and a running daemon;
- a Kernel API key for browser execution;
- access to a linked Vercel project for a full AI Gateway/Blob/Kernel path.

Start from a clean checkout:

```bash
# LOCAL ACTION: Corepack and dependency installation change this checkout/tooling.
corepack enable
pnpm install --frozen-lockfile
./init.sh --check
```

For a full local run using development credentials from the intended Vercel
project, link through Eve before starting. Linking creates `.vercel/` and pulls
development environment values into `.env.local`; both are ignored. Inspect
names, never print values, and keep the file mode private.

```bash
# LOCAL ACTION: link metadata and development values are written to ignored files.
pnpm exec eve link --project <vercel-project-name-or-id> \
  --team <vercel-team-id-or-slug> --non-interactive
chmod 600 .env.local
./init.sh
```

If there is no linked project yet, run `./init.sh` once. It creates
`.env.local` from `.env.example`, sets mode `0600`, and stops. Add
`KERNEL_API_KEY` without committing it, then run `./init.sh` again. This is
enough to exercise bootstrap, database, pages, and Kernel-backed browser paths;
model turns still need valid AI Gateway/Vercel development authentication.

`./init.sh` performs these operations:

1. validates Node 24, pnpm, Docker, Compose v2, and the Docker daemon;
2. preserves any existing `.env.local` and validates a non-empty Kernel key;
3. installs the locked dependency graph;
4. delegates to `pnpm dev`.

`pnpm dev` starts Postgres 17 on a random loopback port, injects its pooled and
direct URLs, runs committed Drizzle migrations, starts Next, and forwards
shutdown signals. `Ctrl-C` removes the container while preserving the named
Docker volume.

### Local authentication and Linq modes

Local loopback development uses Better Auth's intentional phone bypass. Enter
an E.164 phone number and the development code `000000`. This does not call Linq
and proves no external messaging behavior.

Do not point the production Linq trigger at localhost. The supported live Linq
test is a deployed Vercel environment with a dedicated connector/line and
approved Messaging Contact. A separate tunneled local webhook, signature path,
and connector is not currently documented or verified.

### Local acceptance

After startup reports that Next is ready:

```bash
curl --fail --silent --show-error http://localhost:3000/eve/v1/health
curl --fail --silent --show-error --output /dev/null \
  http://localhost:3000/sign-in
```

Then use a browser to complete the real path:

1. load `/sign-in`, request the local code, and enter `000000`;
2. load `/`, `/vault`, `/chat`, and `/tasks`;
3. start one web-chat turn and confirm it streams to completion;
4. start a harmless browser task and confirm the worker-owned Kernel session;
5. stop with `Ctrl-C` and confirm the development supervisor exits cleanly.

Before committing a change, run:

```bash
pnpm check
pnpm build
git diff --check
```

Use a realistic local browser smoke after UI changes. A health response or
unit test alone does not establish the user journey.

## Production prerequisites

- A Vercel team/project and a verified deployment domain.
- Node 24 and pnpm 11.24.0 locally.
- A private Neon Postgres database with pooled and direct connection URLs.
- Kernel access for browser execution.
- A private Vercel Blob store for memory and browser image artifacts.
- Vercel Connect installations for Linq and, if needed, Google Workspace.
- A documented backup owner, rollback owner, and incident contact.

Never paste credentials into source, shell history, tickets, chat, or logs.
Use the Vercel dashboard or an approved secret manager for sensitive values.
These examples target the repository-pinned Vercel CLI 59.6.2; confirm with
`pnpm exec vercel --version` after installing dependencies and before running
them.

## Preflight

1. Confirm the intended repository SHA and a clean worktree.
2. Review `README.md`, `db/README.md`, and the current migration journal.
3. Confirm the domain's TLS, DNS, and Vercel project/environment are the ones
   intended for this deployment.
4. Confirm the database backup completed and record its timestamp.
5. Confirm all required environment variables are available without printing
   their values: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`,
   `DATABASE_URL_UNPOOLED`, `SECRET_ENCRYPTION_KEY`, and `KERNEL_API_KEY`.
6. Confirm private Blob storage is connected and that its environment is the
   intended Vercel environment.

## Initial project and storage provisioning

The following are operator actions. Replace angle-bracket placeholders with
values from the approved project and connector records.

```bash
# OPERATOR ACTION: install the repository-pinned CLI dependencies first.
pnpm install --frozen-lockfile

# OPERATOR ACTION: link this checkout to the intended Vercel project.
pnpm exec eve link --project <vercel-project-name-or-id> --non-interactive

# OPERATOR ACTION: create a private Blob store in each required environment.
pnpm exec vercel blob create-store <blob-store-name> --access private --yes \
  --environment production --environment preview --environment development
```

In Vercel Marketplace, provision and attach these resources to the intended
project before the first deployment:

1. Neon Postgres with both pooled runtime and direct/unpooled migration URLs;
2. Kernel with browser access for production and any intentionally isolated
   non-production environment;
3. one private Vercel Blob store.

The one-click deploy path may create these resources automatically. A manually
created project must verify each attachment in the Vercel project rather than
assuming that owning a Marketplace resource makes it available to the app.
Use separate preview/development resources when their traffic or data must be
isolated. Never attach a production database to an untrusted preview branch.

The Vercel integration supplies the private Blob store identifiers/tokens to
the deployment. Outside that integration, use the repository's supported
private Blob token configuration and document its rotation owner.

## Environment and secret configuration

Set each value through Vercel environment management. Secret values are entered
at the interactive prompt, so they do not appear in shell history or process
arguments. These commands are operator actions:

| Variable                               | Required            | Normal source          | Notes                                                    |
| -------------------------------------- | ------------------- | ---------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                         | Yes                 | Neon attachment        | Pooled request-time URL                                  |
| `DATABASE_URL_UNPOOLED`                | Yes                 | Neon attachment        | Direct migration URL; must target the same database      |
| `KERNEL_API_KEY`                       | Yes                 | Kernel attachment      | Never expose to the model, browser, or logs              |
| `BETTER_AUTH_SECRET`                   | Yes                 | Generated once         | Back up and rotate deliberately                          |
| `BETTER_AUTH_URL`                      | Yes                 | Operator               | Exact canonical HTTPS origin; no guessed alias           |
| `SECRET_ENCRYPTION_KEY`                | Yes                 | Generated once         | Base64-encoded 32 bytes; rotation requires re-encryption |
| `BLOB_STORE_ID` / `VERCEL_OIDC_TOKEN`  | Vercel path         | Blob/Vercel attachment | Preferred short-lived Vercel path                        |
| `BLOB_READ_WRITE_TOKEN`                | Non-Vercel fallback | Private Blob store     | Do not set when the Vercel attachment path is used       |
| `LINQ_CONNECTOR` + `LINQ_PHONE_NUMBER` | Optional pair       | Linq setup             | Both or neither; production-only by default              |
| `GOOGLE_CONNECTOR_UID`                 | Optional            | Google Connect setup   | User-scoped grant path                                   |
| `SQUARE_CONNECTOR_UID`                 | Optional            | Square Connect setup   | User-scoped grant path                                   |
| `SQUARE_ENVIRONMENT`                   | Optional            | Operator               | `sandbox` or `production`; default `sandbox`             |

Generate new application secrets directly into the Vercel prompt rather than
copying them through chat or a ticket:

```bash
# OPERATOR ACTION: generates and stores new production secrets.
openssl rand -base64 32 | \
  pnpm exec vercel env add BETTER_AUTH_SECRET production
openssl rand -base64 32 | \
  pnpm exec vercel env add SECRET_ENCRYPTION_KEY production
pnpm exec vercel env add BETTER_AUTH_URL production
```

Marketplace integrations should inject database and Kernel values. If they do
not, repair the attachment first. Use the following manual prompts only for an
approved non-Marketplace configuration:

```bash
# OPERATOR ACTION: paste each value only at its interactive prompt.
pnpm exec vercel env add DATABASE_URL production
pnpm exec vercel env add DATABASE_URL_UNPOOLED production
pnpm exec vercel env add KERNEL_API_KEY production
```

Repeat configuration for preview/development only when those environments are
intended to access the corresponding isolated resources. Keep the encryption
key backed up separately; changing it requires a controlled re-encryption
migration, not a simple environment replacement.

Audit names and scopes without exporting values:

```bash
pnpm exec vercel env ls
```

`BETTER_AUTH_URL` must equal the canonical production alias actually assigned
by Vercel. A plausible but unassigned project-name URL causes incorrect auth
callbacks even when the deployment itself is healthy.

## Linq connector and trigger

The current channel uses Vercel Connect and one configured deployment line.
Create or select the connector, attach it to the intended project/environment,
and configure the inbound trigger at `/eve/v1/linq`.

Current Linq Partner API documentation does not expose self-serve create/delete
operations for phone lines; new or released lines are handled through Linq.
That does not block the new MVP product plan because customers share a platform
number and are separated by verified identity plus a durable provider
conversation binding. Vercel's managed connector form may provision an
eligible shared line, but the current code does not yet implement that
multi-tenant resolver. Do not describe the reference deployment as
multi-tenant until the isolation tests in `MULTITENANCY.md` pass.

```bash
# OPERATOR ACTION: create the Linq Connect installation.
pnpm exec vercel connect create linq --connection-method line \
  --name <linq-installation-name> --json

# OPERATOR ACTION: attach the returned connector to the intended environment.
pnpm exec vercel connect attach <connector-uid> --project <vercel-project-name-or-id> \
  --environment production --triggers --trigger-path /eve/v1/linq --yes --json

# OPERATOR ACTION: enter the connector UID and assigned deployment line at the
# prompts; do not put values in command arguments.
pnpm exec vercel env add LINQ_CONNECTOR production
pnpm exec vercel env add LINQ_PHONE_NUMBER production

# OPERATOR ACTION: deploy after connector and environment setup.
pnpm exec eve deploy --non-interactive --yes --project <vercel-project-name-or-id>
```

`vercel connect create` may open a Vercel Connect browser flow. There are two
legitimate completion paths:

- request a managed line when the account is eligible; or
- choose **Your own credentials**, enter the Linq Partner API credential through
  the provider form, and select an already assigned line.

Do not put the Linq token or phone number in a CLI flag, repository file, or
support transcript. After the browser reports success, use the registry—not a
stale earlier CLI attempt—as the source of truth, then attach explicitly:

```bash
pnpm exec vercel connect list --json
pnpm exec vercel connect attach <connector-uid> \
  --project <vercel-project-name-or-id> --environment production \
  --triggers --trigger-path /eve/v1/linq --yes --json
```

An attach result with `unchanged: true` is successful idempotency, not a
failure. If managed provisioning reports that the account already owns a shared
line, do not create duplicates; switch to the existing-line credentials path
or resolve ownership with Linq.

Use the Connect dashboard to add only approved users under Messaging Contacts.
The configured line, connector, trigger destination, and contact allowlist are
one deployment-level trust boundary today; they are not a multi-tenant routing
model. The product plan may use the existing Sendblue account through Eve's
Chat SDK channel, but this runbook remains the verified Linq procedure until a
Sendblue migration has its own webhook, delivery, rollback, and isolation
evidence. Repeat attachments and environment variables for preview only when
traffic is intentionally isolated.

Keep `LINQ_CONNECTOR` and `LINQ_PHONE_NUMBER` production-only unless a separate
non-production line and explicit test contact list exist. The reference project
attaches the connector for project access, but only production receives the two
runtime values, so preview/development cannot send through the live line.

Monitor Linq line service status and reputation. A future multi-tenant control
plane must consume `phone_number.status_updated` and stop outbound traffic for
flagged or critical lines; the current single-line application has no tenant
line lifecycle UI.

## Google Workspace connector

Google is optional and currently Vercel Connect-backed. Configure the Google
Cloud consent screen, Gmail/Calendar/People APIs, and the callback URI required
by Vercel Connect. Convert the downloaded client configuration outside the
repository, then perform these operator actions:

```bash
# OPERATOR ACTION: create the OAuth connector from an approved temporary file.
pnpm exec vercel connect create google --connection-method oauth \
  --name <google-installation-name> --data @<temporary-credentials-file>

# OPERATOR ACTION: attach the connector to the intended Vercel environment.
pnpm exec vercel connect attach <google-connector-uid> --project <vercel-project-name-or-id> \
  --environment production --yes

# OPERATOR ACTION: enter the connector identifier at the prompt, then redeploy.
pnpm exec vercel env add GOOGLE_CONNECTOR_UID production
pnpm exec eve deploy --non-interactive --yes --project <vercel-project-name-or-id>
```

Delete the temporary credentials file after the connector accepts it. The
grant is keyed to the authenticated OpenInstinct user today. It is not an
installation-to-tenant mapping. For future multi-tenant support, persist and
audit that mapping only after deciding whether a Google grant is personal or
shared and how active-tenant authorization works.

## Square connector

Square is optional and Vercel Connect-backed, one grant per user. In the
Square Developer Dashboard, open the sandbox (or production) application and
add `https://connect.vercel.com/callback` as an OAuth redirect URL. Copy the
application id and secret into a temporary credentials file outside the
repository.

Square's discovery document describes "Sign in with Square" login, not the
merchant API OAuth endpoints, so Vercel Connect cannot detect them
automatically. Create the connector by URL and, if the CLI does not pick up
the endpoints, enter them by hand in the dashboard: authorization
`https://connect.squareupsandbox.com/oauth2/authorize`, token
`https://connect.squareupsandbox.com/oauth2/token`, grant types
`authorization_code` and `refresh_token`, and scopes
`MERCHANT_PROFILE_READ ITEMS_READ CUSTOMERS_READ ORDERS_READ PAYMENTS_READ INVOICES_READ INVENTORY_READ APPOINTMENTS_READ`.
Production uses `connect.squareup.com` in place of
`connect.squareupsandbox.com` throughout.

```bash
# OPERATOR ACTION: create the Custom OAuth connector from an approved temporary file.
pnpm exec vercel connect create connect.squareupsandbox.com \
  --name square-sandbox --data @<temporary-credentials-file>

# OPERATOR ACTION: attach the connector to the intended Vercel environment.
pnpm exec vercel connect attach <square-connector-uid> --project <vercel-project-name-or-id> \
  --environment production --yes

# OPERATOR ACTION: enter the connector identifier at the prompt. "production"
# names the Vercel environment. When prompted for the SQUARE_ENVIRONMENT value,
# enter "sandbox" for the sandbox connector or "production" for the production
# connector. Then redeploy.
pnpm exec vercel env add SQUARE_CONNECTOR_UID production
pnpm exec vercel env add SQUARE_ENVIRONMENT production
pnpm exec eve deploy --non-interactive --yes --project <vercel-project-name-or-id>
```

Square sandbox OAuth requires the sandbox seller test account to be opened
from the Developer Dashboard in the same browser before a user clicks
Connect; otherwise the authorize step fails. Delete the temporary credentials
file after the connector accepts it.

## Migration and deployment

Review the migration for backward compatibility, take a backup, and let the
Vercel build path run the uncached migration against the direct URL. Do not run
schema generation as part of an emergency deploy.

```bash
# Read-only/local repository gate.
pnpm check

# Build with production environment injected into the subprocess without
# writing a new env file. This does not deploy.
pnpm exec vercel env run -e production -- pnpm build

# OPERATOR ACTION: after backup and target confirmation, apply the committed
# migration to the production direct URL. The later Vercel build reruns this
# idempotently.
pnpm exec vercel env run -e production -- pnpm db:migrate

# OPERATOR ACTION: deploy the selected revision.
pnpm exec eve deploy --non-interactive --yes \
  --project <vercel-project-name-or-id> --team <vercel-team-id-or-slug>
```

The Vercel build configuration runs the migration task before the application
build. Confirm deployment logs show the intended migration set and no stale
database URL. Better Auth tables are included in the committed Drizzle history.

`eve deploy` installs dependencies, invokes a production Vercel deployment, and
pulls development environment values afterward. Its local preflight may report
production-only variables as absent before the remote deploy; judge the remote
build and deployment result separately. Remove the pulled `.env.local` when the
checkout is temporary.

Record the source SHA, deployment ID, immutable deployment URL, production
alias, migration set, operator, and timestamp. Confirm readiness before sending
traffic:

```bash
pnpm exec vercel inspect <immutable-deployment-url> --wait
pnpm exec vercel logs <immutable-deployment-url> \
  --since 30m --level error --no-follow
curl --fail --silent --show-error \
  https://<deployment-domain>/eve/v1/health
```

## Tenant bootstrap and verification

The current system may create a personal workspace lazily during the first
scoped manager/session operation. Do not call this true multi-tenancy. A future
bootstrap should extend the workspace with lifecycle/policy state and create
its owner membership, installation mappings, quota, and audit baseline in one
server-side operation.

Acceptance checklist:

- [ ] `GET https://<deployment-domain>/eve/v1/health` returns the expected health response.
- [ ] An authenticated user can load `/`, `/vault`, and `/chat`.
- [ ] One complete web-chat turn starts, streams, completes, and appears in the scoped history.
- [ ] One complete Linq turn is received through `/eve/v1/linq`, mapped to the intended verified user, and replies on the same thread.
- [ ] A second test identity cannot read the first identity's chats, vault metadata, images, browser sessions, or settings.
- [ ] Browser execution proves worker/root ownership checks and does not expose vault plaintext.
- [ ] Private Blob artifact delivery requires authentication and returns no cross-scope object.
- [ ] Google remains clearly marked unavailable unless its connector/grant test passes.
- [ ] Usage/cost observations are recorded and no provider credential appears in logs.

Health alone is not a deployment acceptance test.

### Non-message smoke

This proves routing and configuration without sending a real message:

```bash
curl --fail --silent --show-error \
  https://<deployment-domain>/eve/v1/health
curl --fail --silent --show-error --output /dev/null \
  https://<deployment-domain>/sign-in
curl --fail --silent --show-error \
  https://<deployment-domain>/api/auth/get-session
pnpm exec vercel connect list --json
pnpm exec vercel env ls
```

Expected results are Eve `ready`, a `200` sign-in page containing the phone
form rather than the missing-Linq warning, an anonymous session response before
login, the intended connector UID, and both Linq variable names scoped to
production. `vercel env ls` may show masked value prefixes for integration
configuration; do not paste its raw output into tickets.

### Live Linq acceptance

This sends real messages. Obtain action-time authorization from the recipient,
use a designated test contact, and record the test without copying message
contents or the full phone number into logs.

1. Add the recipient under the connector's Messaging Contacts.
2. On `/sign-in`, request one OTP and confirm delivery from the assigned line.
3. Enter the OTP, confirm the authenticated manager loads, and sign out.
4. Send one harmless inbound message to the agent line.
5. Confirm Vercel Connect forwards it to `/eve/v1/linq`, Eve resolves the
   intended identity/workspace, and the reply returns on the same thread.
6. Confirm one chat/session, usage observation, and redacted provider trace.
7. Repeat one duplicate/retry fixture in staging; it must not duplicate an
   externally visible side effect.

Do not call a deployment “Linq verified” when only the connector registry,
health route, or sign-in form was checked.

## Troubleshooting

| Symptom                                                       | Likely boundary               | Check and response                                                                                                         |
| ------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `./init.sh --check` fails                                     | Local prerequisite            | Install Node 24/pnpm/Compose or start Docker; do not bypass the guard                                                      |
| Local pages work but model turns fail                         | AI Gateway auth               | Link the intended Vercel project and refresh development environment/OIDC; do not invent a provider key path               |
| Local sign-in never sends an OTP                              | Expected development adapter  | Use code `000000` on loopback; live Linq requires a deployed test environment                                              |
| Sign-in says Linq is not configured                           | Environment pair              | Confirm both `LINQ_CONNECTOR` and `LINQ_PHONE_NUMBER` exist in the same environment, then redeploy                         |
| OTP delivery says contact is not allowed                      | Linq contact policy           | Add only the approved test/user identity under Messaging Contacts                                                          |
| Connector browser says ready but the waiting create CLI fails | Earlier create attempt        | Run `vercel connect list --json`; if the intended UID exists, attach it explicitly and treat the registry as authoritative |
| Managed Linq form says the account already has a shared line  | Provider ownership            | Use the existing-line credentials flow or resolve ownership with Linq; do not provision duplicates                         |
| Outbound Linq works but inbound messages do not               | Trigger routing               | Inspect connector attachment and exact `/eve/v1/linq` path; verify the deployed Eve route before changing the Next proxy   |
| Auth redirects to an unexpected host                          | Canonical URL                 | Correct `BETTER_AUTH_URL` to the assigned production alias and redeploy                                                    |
| Eve local preflight lists missing production variables        | Local versus remote env       | Confirm Vercel project env names and remote build result; do not mistake the local warning for a completed remote failure  |
| Deployment migration targets the wrong database               | Project/env attachment        | Stop promotion, identify pooled/direct URL ownership without printing values, restore/repair before traffic                |
| Migration emits the PostgreSQL SSL-mode deprecation warning   | Dependency compatibility      | Record it and plan an explicit connection-string compatibility change; do not silently weaken TLS                          |
| Preview can send from the production line                     | Environment isolation failure | Remove the two Linq runtime values from preview/development, rotate if exposed, and verify trigger ownership               |
| Browser work fails while chat works                           | Kernel boundary               | Check Kernel attachment, key scope, provider health, worker/root ownership, and browser logs                               |
| Artifacts fail while chat works                               | Blob boundary                 | Confirm a private store attachment/token and scoped manifest; never make the store public as a workaround                  |

For deployed Eve failures, use Vercel Agent Runs/Observability when enabled,
plus deployment logs and provider traces. Correlate by deployment, session,
turn, worker task, and provider trace ID. Do not include tokens, full phone
numbers, vault plaintext, screenshots, or message contents in diagnostic logs.

## Operations

- Monitor Vercel function/service logs, Eve workflow runs, Postgres health,
  Kernel browser failures, Blob errors, Linq delivery, and Google grant status.
- Correlate incidents by deployment, Eve session, worker task, workflow run,
  and authenticated user. Do not log vault values or provider tokens.
- Keep the private Blob store and `SECRET_ENCRYPTION_KEY` backup ownership
  separate from application deploy ownership.
- Rotate API credentials through the provider/dashboard and deployment
  environment manager, then redeploy and verify one complete turn.
- For connector changes, isolate preview traffic and confirm trigger
  destinations do not point at the wrong environment.

## Credential rotation

Rotate one boundary at a time and keep the last known good deployment available:

- **Linq Partner token:** create/activate the replacement with Linq, update the
  Vercel Connect connector through its credential UI, revoke the old token,
  redeploy, then run one authorized OTP and inbound/reply test.
- **Kernel key:** rotate at Kernel, repair the Marketplace/project attachment or
  production variable, redeploy, and run a harmless worker browser task.
- **Better Auth secret:** expect existing sessions/cookies to become invalid;
  schedule the change and test a fresh phone sign-in.
- **Secret encryption key:** never replace it directly. Implement and verify a
  versioned re-encryption migration with rollback/recovery before changing the
  active key.
- **Database credentials:** rotate pooled and direct URLs together, verify they
  reference the same database, test migration connectivity, then redeploy.
- **API/webhook keys:** the proposed multi-tenant product must support overlap,
  visible key IDs, explicit revocation, and audited rotation; that facility does
  not exist today.

Any credential pasted into chat, shell history, a ticket, or logs should be
treated as exposed even when the repository scan is clean.

## Rollback

1. Stop new rollout promotion and record the failing deployment ID, migration,
   provider symptoms, and last known good deployment.
2. If the failure is application-only and the schema remains compatible, use
   the Vercel dashboard or the operator command
   `pnpm exec vercel rollback <last-known-good-deployment-url>`.
3. Do not reverse a committed migration by deleting rows or editing migration
   history. Use a forward-compatible repair migration or restore rehearsal.
4. If credentials or encryption material may be exposed, revoke/rotate them
   before promotion and verify the new deployment environment.
5. Re-run the health, web-chat, Linq, isolation, and artifact acceptance checks.

## Backup and restore rehearsal

Back up Neon using the approved provider procedure before migrations and on the
documented schedule. Store backup metadata, retention, and encryption ownership
outside the application repository. A restore rehearsal is an operator action:

1. Restore into an isolated database/project environment.
2. Point only that environment's direct and pooled URLs at the restored copy.
3. Run migrations and verify constraints, workspace ownership, auth rows,
   encrypted secret rows, and artifact manifests.
4. Run a complete web-chat test and, when the restore environment has an
   isolated staging line, one authorized Linq round trip with a designated test
   contact. Do not route production contacts to the restore environment.
5. Record recovery time, missing external objects, and the follow-up owner.

Blob and Kernel objects require their own inventory/retention strategy; a
Postgres restore alone does not restore them.

## Incident response

For suspected cross-tenant access, credential exposure, duplicate external
action, or webhook compromise:

1. Disable the affected connector/line or deployment action at the provider.
2. Preserve deployment, Eve, provider, database, and audit evidence without
   copying secrets or personal message contents into tickets.
3. Revoke/rotate affected credentials and freeze risky external actions.
4. Identify impacted tenants/users from current scoped records and provider
   traces. Use the proposed tenant audit ledger only after it is implemented.
5. Restore service only after isolation, auth, webhook, and approval checks pass.
6. Record a timeline, root cause, data/side-effect scope, and remediation gate.

## Teardown

Teardown is an operator action and must be approved by the data owner. First
export/retain required audit evidence, revoke Linq/Google/Kernel/Blob access,
disable trigger destinations, remove environment secrets, and then delete the
Vercel project and database according to the retention policy. Confirm that
backups and provider installations have reached their intended lifecycle state.

## Maintainer references

This runbook was checked against the repository-pinned CLIs and installed Eve
0.46.1 documentation for Vercel deployment, route auth, connections, channels,
and security. Provider-sensitive sections were checked against current Vercel
CLI/Connect guidance and Linq Partner API documentation on 2026-08-29.

Before changing commands or provider lifecycle claims:

```bash
pnpm exec eve --version
pnpm exec vercel --version
pnpm exec eve deploy --help
pnpm exec vercel connect --help
pnpm exec vercel connect attach --help
```

Then update the verification date and exact behavior exercised. Do not assume a
managed-connector UI, Marketplace environment name, webhook retry policy, or
line-provisioning capability remains unchanged.
