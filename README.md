# Local Vault Assistant

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMerit-Systems%2Fopen-instinct&project-name=local-vault-assistant&repository-name=local-vault-assistant&env=KERNEL_API_KEY&envDescription=Kernel%20API%20key%20for%20cloud%20browser%20tasks.&envLink=https%3A%2F%2Fwww.kernel.sh%2Fdocs%2Freference%2Fcli%2Fauth)

## Your agent should work for you—not hold the keys to your life

Personal agents become dramatically more useful when they can sign in, book, buy, send, and act on your behalf. They also become dramatically more dangerous when every password, payment credential, and identity detail must live in somebody else's cloud.

Local Vault Assistant keeps that trust boundary on your device:

- Raw secrets live in your operating system's keychain—not in browser storage, chat history, or a hosted agent database.
- Models receive safe metadata and opaque handles instead of a downloadable copy of your vault.
- You can change models, agent runtimes, and browser providers without migrating ownership of your credentials.
- Local inference is optional, so both the reasoning layer and the vault can remain on-device.
- Remote access to the manager is blocked by default.

The result is a personal agent with useful browser capabilities and a much smaller trust surface.

## What you get

- A local manager for models, connections, and auth-vault items at `/`
- A conversational agent at `/chat`
- Recoverable parallel browser jobs with time, outcome, and model-cost tracking at `/tasks`
- macOS Keychain storage for secret values and a private local database for metadata
- Local or hosted OpenAI-compatible inference

## Run locally

Requires Node.js 24 and macOS for Keychain-backed secrets.

```bash
git clone https://github.com/Merit-Systems/open-instinct.git
cd open-instinct
corepack enable
./local-assistant
```

Open [localhost:3000](http://localhost:3000), add your connections, then start chatting.

To configure a local model without the manager:

```bash
LOCAL_VAULT_ASSISTANT_MODEL=qwen3.5:27b \
LOCAL_VAULT_ASSISTANT_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
./local-assistant
```

## Deploy on Vercel

The button at the top deploys the hosted chat and browser-task surfaces. It asks for a Kernel API key; Vercel AI Gateway supplies the default model through project OIDC.

The vault and connection manager remain device-only. Hosted deployments open at `/chat`; run locally when you need Keychain-backed credentials.

```bash
pnpm exec eve deploy --project local-vault-assistant --non-interactive --yes
```

## Implementation details

- [Eve](https://eve.dev) provides durable agent sessions, streaming, tools, and the web conversation protocol.
- [Kernel](https://kernel.sh) provides cloud browsers, Playwright, computer use, profiles, proxies, and browser execution.
- Next.js provides the local manager, chat, and batch-runner interfaces.
- SQLite stores non-secret metadata locally; macOS Keychain stores secret values.

These are replaceable implementation layers. The durable product boundary is the locally owned vault.
