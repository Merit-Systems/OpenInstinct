# Vercel operator runbook

This is the supported deployment path for the current repository. It is an
operator procedure, not a production-readiness claim. Hetzner, Railway, and
portable provider credentials are outside this runbook.

## Preconditions

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

The Vercel integration supplies the private Blob store identifiers/tokens to
the deployment. Outside that integration, use the repository's supported
private Blob token configuration and document its rotation owner.

## Environment and secret configuration

Set each value through Vercel environment management. Secret values are entered
at the interactive prompt, so they do not appear in shell history or process
arguments. These commands are operator actions:

```bash
# OPERATOR ACTION: paste each value only at its interactive prompt.
pnpm exec vercel env add BETTER_AUTH_SECRET production
pnpm exec vercel env add BETTER_AUTH_URL production
pnpm exec vercel env add DATABASE_URL production
pnpm exec vercel env add DATABASE_URL_UNPOOLED production
pnpm exec vercel env add SECRET_ENCRYPTION_KEY production
pnpm exec vercel env add KERNEL_API_KEY production
```

Repeat configuration for preview/development only when those environments are
intended to access the corresponding isolated resources. Keep the encryption
key backed up separately; changing it requires a controlled re-encryption
migration, not a simple environment replacement.

## Linq connector and trigger

The current channel uses Vercel Connect and one configured deployment line.
Create or select the connector, attach it to the intended project/environment,
and configure the inbound trigger at `/eve/v1/linq`.

```bash
# OPERATOR ACTION: create the Linq Connect installation.
pnpm exec vercel connect create linq --connection-method line --name <linq-installation-name> --json

# OPERATOR ACTION: attach the returned connector to the intended environment.
pnpm exec vercel connect attach <connector-uid> --project <vercel-project-name-or-id> \
  --environment production --triggers --trigger-path /eve/v1/linq --yes

# OPERATOR ACTION: enter the connector UID and assigned deployment line at the
# prompts; do not put values in command arguments.
pnpm exec vercel env add LINQ_CONNECTOR production
pnpm exec vercel env add LINQ_PHONE_NUMBER production

# OPERATOR ACTION: deploy after connector and environment setup.
pnpm exec eve deploy --non-interactive --yes --project <vercel-project-name-or-id>
```

Use the Connect dashboard to add only approved users under Messaging Contacts.
The configured line, connector, trigger destination, and contact allowlist are
one deployment-level trust boundary today; they are not a multi-tenant routing
model. Repeat attachments and environment variables for preview only when
traffic is intentionally isolated.

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

## Migration and deployment

Review the migration for backward compatibility, take a backup, and let the
Vercel build path run the uncached migration against the direct URL. Do not run
schema generation as part of an emergency deploy.

```bash
# OPERATOR ACTION: inject the actual TARGET environment's direct URL
# ephemerally through the approved secret manager/CI variable, verify the
# target project/environment identity, and then run the migration in that
# process. Do not write the URL to a file or use a disposable database.
pnpm db:migrate

# OPERATOR ACTION: run repository gates before deployment.
pnpm check
pnpm build

# OPERATOR ACTION: deploy the selected revision.
pnpm exec eve deploy --non-interactive --yes --project <vercel-project-name-or-id>
```

The Vercel build configuration runs the migration task before the application
build. Confirm deployment logs show the intended migration set and no stale
database URL. Better Auth tables are included in the committed Drizzle history.

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

## Rollback

1. Stop new rollout promotion and record the failing deployment ID, migration,
   provider symptoms, and last known good deployment.
2. If the failure is application-only and the schema remains compatible, use
   the Vercel dashboard to promote the last known good deployment. This is an
   operator action.
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
4. Run a complete web-chat and Linq test without using production contacts or
   external side effects.
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
4. Identify impacted tenants/users from scoped audit records.
5. Restore service only after isolation, auth, webhook, and approval checks pass.
6. Record a timeline, root cause, data/side-effect scope, and remediation gate.

## Teardown

Teardown is an operator action and must be approved by the data owner. First
export/retain required audit evidence, revoke Linq/Google/Kernel/Blob access,
disable trigger destinations, remove environment secrets, and then delete the
Vercel project and database according to the retention policy. Confirm that
backups and provider installations have reached their intended lifecycle state.
