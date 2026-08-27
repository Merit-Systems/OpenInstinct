# Local Vault Assistant

## Your agent doesn't need root access to your life

Personal agents become dramatically more useful when they can sign in, book,
buy, send, and act on your behalf. They also become dramatically more dangerous
when the application, credentials, and browser sessions are operated by someone
else.

Local Vault Assistant is designed to be self-hosted in your own Vercel account.
You own the deployment and its Kernel and Neon resources; Merit does not operate
a shared hosted instance. Models receive safe metadata and opaque handles
instead of a downloadable copy of your vault, and secret values are encrypted
before they are written to your database.

## Deploy your own instance

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMerit-Systems%2Fopen-instinct&project-name=open-instinct&repository-name=open-instinct&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22other%22%2C%22productSlug%22%3A%22kernel%22%2C%22integrationSlug%22%3A%22kernel%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%5D)

This is the primary way to run Local Vault Assistant. The deploy flow
provisions the Eve runtime in your Vercel project, uses Vercel AI Gateway for
inference through project OIDC, and requires the Kernel and Neon Marketplace
resources. Kernel creates the browser account and securely injects
`KERNEL_API_KEY`. Neon creates a Postgres database and injects `DATABASE_URL`.
You do not need to create either resource or copy its credentials manually.

Kernel and Neon usage are billed to the Vercel account that owns the deployment.

## What you get

- A manager for models and vault items at `/`
- A conversational agent at `/chat`
- A workspace-wide conversation index at `/chats`
- Recoverable parallel browser jobs with time, outcome, and model-cost tracking at `/tasks`
- Encrypted secret storage in your own Postgres database
- OpenAI-compatible inference through Vercel AI Gateway
- Passwordless SMS sign-in and isolated personal workspaces

## Configure authentication

The self-hosted deployment uses Better Auth, Textbelt SMS, Postgres, and an
application encryption key. Each authenticated phone account receives a stable
personal workspace. Manager settings, vault metadata, encrypted secrets, agent
sessions, and task history are scoped to that workspace.

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
BETTER_AUTH_URL=https://your-host
TEXTBELT_API_KEY=your-textbelt-api-key
DATABASE_URL=postgresql://user:password@host/database
SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

The UI asks for a phone number and signs the user in with a one-time SMS code. A
user's first successful verification creates their account. Phone numbers
without a country code default to `+1`; an explicit `+` country code is
preserved. Better Auth tables are migrated automatically when the authentication
surface is first used.

Secrets are encrypted with AES-256-GCM before being written to Postgres. Treat
`SECRET_ENCRYPTION_KEY` as production key material: store it in the
deployment secret manager, restrict access, and back it up separately. Rotating
that key requires re-encrypting existing values.

## Local development

The Vercel deployment is the supported production path. You can run the same
architecture locally while developing it by configuring the variables in
`.env.example`, then starting the Next.js app:

```bash
git clone https://github.com/Merit-Systems/open-instinct.git
cd open-instinct
pnpm install
pnpm dev
```

Local development uses the same Postgres database, encrypted vault, Better Auth,
Kernel browser, and AI Gateway model path as the Vercel deployment. There is no
separate local-only runtime.

## Implementation details

- [Eve](https://eve.dev) provides durable agent sessions, streaming, tools, and the web conversation protocol.
- [Kernel](https://kernel.sh) provides cloud browsers, Playwright, computer use, profiles, proxies, and browser execution.
- Next.js provides the manager, chat, and batch-runner interfaces.
- The application uses workspace-scoped Postgres rows and encrypted secret values in every environment.

These are replaceable implementation layers. The durable product boundary is
the instance you operate.
