# OpenInstinct

A personal iMessage assistant that can use a browser like you. It can do your chores, book you movie tickets, or handle your groceries. You stay in control of your passwords, credit cards and context.

It's Open Source, self-hostable, and can use any model. One-click deploy to Vercel and get rolling.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMerit-Systems%2Fopen-instinct&project-name=open-instinct&repository-name=open-instinct&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22other%22%2C%22productSlug%22%3A%22kernel%22%2C%22integrationSlug%22%3A%22kernel%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%5D)

## Why self-host?

Personal agents are much more useful when they can sign in, book, buy and act on your behalf. But your accounts, your passwords, are the keys to your digital kingdom. OpenInstinct runs in your own Vercel account. Secrets are encrypted before they touch your database and models never see them. Verify yourself by reading the code!


## What you get

- A conversational agent at `/chat`, plus a vault and model manager at `/`
- Parallel browser tasks with time, outcome, and cost tracking at `/tasks`
- Encrypted secret storage in your own Postgres database
- Passwordless SMS sign-in with isolated personal workspaces

The deploy flow provisions everything: [Kernel](https://kernel.sh) for cloud
browsers, [Neon](https://neon.tech) for Postgres, and Vercel AI Gateway for
inference. Usage is billed to your Vercel account. Set the remaining auth
variables on the deployment:

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
BETTER_AUTH_URL=https://your-host
TEXTBELT_API_KEY=your-textbelt-api-key
SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

Treat `SECRET_ENCRYPTION_KEY` as production key material — back it up
separately; rotating it requires re-encrypting existing values.

## Local development

Configure the variables in `.env.example`, then:

```bash
git clone https://github.com/Merit-Systems/open-instinct.git
cd open-instinct
pnpm install
pnpm dev
```

Local development uses the same Postgres, vault, Kernel browser, and AI Gateway
path as the Vercel deployment — there is no separate local-only runtime.

# Providers
Vercel, Kernel, Linq, Neon