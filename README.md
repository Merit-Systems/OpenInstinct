<div align="center">

<img src=".github/logo.png" alt="OpenInstinct" width="420">

**A personal iMessage assistant that can use a browser like you.**

It can do your chores, book you movie tickets, or handle your groceries.
You stay in control of your passwords, credit cards and context.

It's Open Source, self-hostable, and can use any model.
One-click deploy to Vercel and get rolling.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMerit-Systems%2Fopen-instinct&project-name=open-instinct&repository-name=open-instinct&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22other%22%2C%22productSlug%22%3A%22kernel%22%2C%22integrationSlug%22%3A%22kernel%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%5D)

<img src=".github/demo.png" alt="OpenInstinct booking movie tickets over iMessage — it walks Fandango to checkout and reports the theater, showtime, seat, and total" width="640">

</div>

## Why self-host?

Personal agents are much more useful when they can sign in, book, buy and act
on your behalf. But your accounts, your passwords, are the keys to your digital
kingdom. OpenInstinct runs in your own Vercel account. Secrets are encrypted
before they touch your database and models never see them. Verify yourself by
reading the code!

## Deployment

The deploy flow provisions everything: [Kernel](https://kernel.sh) for cloud
browsers, [Neon](https://neon.tech) for Postgres, [Linq](https://linq.app) for
the iMessage line, and Vercel AI Gateway for inference. Usage is billed to your
Vercel account. Set the remaining auth variables on the deployment:

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
BETTER_AUTH_URL=https://your-host
DATABASE_URL=postgresql://user:password@host/database
DATABASE_URL_UNPOOLED=postgresql://user:password@host/database
SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

The application database schema and versioned migrations live in `db/`. The
Drizzle application store uses `DATABASE_URL` for runtime queries; its migration
commands require the direct `DATABASE_URL_UNPOOLED` connection. Run
`pnpm db:migrate` before starting against a new or upgraded local database.
Vercel uses Turbo to run the uncached migration task before its application
build. See [`db/README.md`](db/README.md) for existing-database adoption,
environment loading, and constraint-validation sequencing. Better Auth retains
its separate migration path.

Treat `SECRET_ENCRYPTION_KEY` as production key material — back it up
separately; rotating it requires re-encrypting existing values.

## Local development

Docker Desktop (or another Docker Compose installation) is required. Configure
the non-database variables in `.env.example`, then:

```bash
git clone https://github.com/Merit-Systems/open-instinct.git
cd open-instinct
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL from `compose.yaml`, applies the committed database
migrations, and starts the application. Stopping the development process also
stops and removes the PostgreSQL container; its data remains in the
`postgres-data` volume for the next run. Run `pnpm dev:app` when intentionally
using an externally managed database instead.

Local development otherwise uses the same vault, Kernel browser, and AI Gateway
path as the Vercel deployment.

> [!WARNING]
> This is not software intended for production use.

---

<div align="center">

Built on [Vercel](https://vercel.com) · [Kernel](https://kernel.sh) · [Linq](https://linq.app) · [Neon](https://neon.tech)

</div>
