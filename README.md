# Local Vault Assistant

## Your agent doesn't need root access to your life

Personal agents become dramatically more useful when they can sign in, book, buy, send, and act on your behalf. They also become dramatically more dangerous when every password, payment credential, and identity detail must live in somebody else's cloud.

Local Vault Assistant keeps that trust boundary on your device:

- Raw secrets live in your operating system's keychain—not in browser storage, chat history, or a hosted agent database.
- Models receive safe metadata and opaque handles instead of a downloadable copy of your vault.
- You can change models, agent runtimes, and browser providers without migrating ownership of your credentials.
- Local inference is optional, so both the reasoning layer and the vault can remain on-device.
- Remote access to the manager is blocked by default.

The result is a personal agent with useful browser capabilities and a much smaller trust surface.

## Choose how to run it

| Path           | Runs where                | Browser                       | Best for                                      |
| -------------- | ------------------------- | ----------------------------- | --------------------------------------------- |
| Fully local    | Your Mac                  | Your isolated local browser   | Maximum local control                         |
| Personal cloud | Your Vercel account       | Your Kernel resource          | An always-on instance you own                 |
| Merit cloud    | Merit's shared deployment | Merit-managed Kernel browsers | Using the hosted service without operating it |

### Deploy your own personal cloud

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMerit-Systems%2Fopen-instinct&project-name=open-instinct&repository-name=open-instinct&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22other%22%2C%22productSlug%22%3A%22kernel%22%2C%22integrationSlug%22%3A%22kernel%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%5D)

The deploy flow provisions the Eve runtime in your Vercel project, uses Vercel
AI Gateway for inference through project OIDC, and requires the Kernel and Neon
Marketplace resources. Kernel creates the browser account and securely injects
`KERNEL_API_KEY`. Neon creates a Postgres database and injects `DATABASE_URL`.
You do not need to create either resource or copy its credentials manually.

This is a personally operated cloud deployment, not the shared Merit instance.
Kernel and Neon usage are billed to the Vercel account that owns the deployment.

## What you get

- A local manager for models, connections, and auth-vault items at `/`
- A conversational agent at `/chat`
- A workspace-wide conversation index at `/chats`
- Recoverable parallel browser jobs with time, outcome, and model-cost tracking at `/tasks`
- macOS Keychain storage for secret values and a private local database for metadata
- Local or hosted OpenAI-compatible inference
- Optional hosted mode with passwordless SMS sign-in and isolated personal workspaces

## Run locally

The fastest path is one installer and one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Merit-Systems/open-instinct/main/install.sh | bash
~/.local/bin/local-vault-assistant
```

The installer sets up an isolated Node.js runtime, installs the app, and builds it. The launcher opens the manager at `https://local-vault-assistant.localhost`, where you choose browser execution and a hosted or local model. [Portless](https://github.com/vercel-labs/portless) assigns the underlying app port, so the assistant never claims `localhost:3000` and its URL stays stable across restarts.

For full browser isolation and visual computer use, start Docker Desktop and run this one-time install before launching the app:

```bash
~/.local/bin/local-vault-assistant browser install
```

The browser then runs headfully inside a hidden container with a persistent profile; it does not open an extra desktop window. Without the image, the launcher falls back to a limited headless browser. Hosted browser execution uses the system `KERNEL_API_KEY` when configured. The personal-cloud deploy flow provisions it automatically through the Kernel Marketplace resource.

Portless may ask for administrator approval on first launch to trust its local HTTPS certificate and bind the standard HTTPS port. The app and its vault still run only on your machine.

```bash
~/.local/bin/local-vault-assistant doctor  # Check the installation
~/.local/bin/local-vault-assistant update  # Download and build the latest version
```

macOS is currently required for the Keychain-backed vault. To work from a source checkout instead:

```bash
git clone https://github.com/Merit-Systems/open-instinct.git
cd open-instinct
./bin/local-assistant --dev
```

To configure a local model without the manager:

```bash
LOCAL_VAULT_ASSISTANT_MODEL=qwen3.5:27b \
LOCAL_VAULT_ASSISTANT_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
./bin/local-assistant
```

App metadata defaults to a private SQLite database on this device. To use Neon
instead, provide its Postgres connection string when starting the app:

```bash
DATABASE_URL=postgresql://user:password@host/database ./bin/local-assistant
```

This changes the metadata backend; secret values remain in macOS Keychain.
Personal-cloud deployments receive `DATABASE_URL` automatically from the Neon
Marketplace resource.

Local mode remains the default outside Vercel. It requires no account, creates a
stable local workspace automatically, and continues to use SQLite plus macOS
Keychain.

## Run for multiple users

Hosted mode requires Better Auth, Textbelt SMS, Postgres, and an
application encryption key. Each authenticated phone account receives a stable
personal workspace. Manager
settings, connections, vault metadata, encrypted secrets, agent sessions, and
task history are scoped to that workspace.

```bash
LOCAL_VAULT_ASSISTANT_MODE=hosted
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
BETTER_AUTH_URL=https://your-host
TEXTBELT_API_KEY=your-textbelt-api-key
DATABASE_URL=postgresql://user:password@host/database
HOSTED_SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

The hosted UI asks for a phone number and then signs the user in with a one-time
SMS code. A user's first successful verification creates their account. Phone
numbers without a country code default to `+1`; an explicit `+` country code is
preserved. Better Auth tables are migrated automatically when the hosted auth
surface is first used. On Vercel, hosted mode is selected automatically;
setting `LOCAL_VAULT_ASSISTANT_MODE=local` keeps the no-login experience for an
explicitly local deployment and does not contact Better Auth or the SMS service.

Hosted secrets are encrypted with AES-256-GCM before being written to Postgres.
Treat `HOSTED_SECRET_ENCRYPTION_KEY` as production key material: store it in the
deployment secret manager, restrict access, and back it up separately. Rotating
that key requires re-encrypting existing values.

## Implementation details

- [Eve](https://eve.dev) provides durable agent sessions, streaming, tools, and the web conversation protocol.
- [Kernel](https://kernel.sh) provides cloud browsers, Playwright, computer use, profiles, proxies, and browser execution.
- Next.js provides the local manager, chat, and batch-runner interfaces.
- SQLite stores local non-secret metadata and macOS Keychain stores local secret
  values. Hosted deployments use workspace-scoped Postgres rows and encrypted
  secret values.

These are replaceable implementation layers. The durable product boundary is the locally owned vault.
