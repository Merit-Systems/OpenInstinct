# Eve Kernel

An experimental [Eve](https://eve.dev) agent with the default Web Chat UI and Kernel's official [`@onkernel/eve-extension`](https://www.kernel.sh/docs/integrations/vercel/eve-extension).

The extension mounts Kernel's hosted MCP server and maintained `browse` skill. The agent has the complete Kernel MCP toolset: browser lifecycle, Playwright, computer controls, browser curl, managed authentication and credentials, profiles, proxies, replays, browser pools, and VM command execution.

## Browser request compiler experiment

Eve can learn a repeatable read task from a Kernel browser trace and replay the useful network request without repeating the UI navigation. Ask it to compile a task, for example:

> Find coffee shops in Boston in the browser, learn the task, then test the compiled version with Chicago.

The agent enables Kernel telemetry, performs the first task normally, selects an observed JSON API request, replaces the concrete input with a named parameter, and verifies a second call through Kernel browser curl. The compiled request still inherits the live browser's cookies, TLS identity, and proxy, but skips page navigation and visual reasoning.

This first version intentionally compiles only successful JSON `GET` fetch/XHR requests. Parameterization uses exact examples from the observed request, compiled artifacts live only in the current Eve chat session, and captured headers, cookies, credentials, request bodies, and response bodies are never persisted in the artifact.

## Getting started

Install dependencies, configure Kernel, and run the development server:

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Set `KERNEL_API_KEY` in `.env.local`, then open the local Next.js URL to use the chat UI. The deployed agent uses the shared Kernel API key configured in Vercel.

For Eve's terminal interface, run:

```bash
pnpm dev:eve
```

Start by editing `agent/instructions.md` to define the agent's identity, purpose, tone, and response guidelines. Configure its model and runtime behavior in `agent/agent.ts`.

Add capabilities under `agent/`, including tools, connections, channels, skills, subagents, and schedules. eve reloads your changes as you work.

## Learn more

To learn more about eve, explore these resources:

- [eve documentation](https://eve.dev/docs) — learn about eve's features and authoring APIs.
- [Build an Agent tutorial](https://eve.dev/docs/tutorial/first-agent) — build and deploy an agent step by step.
- [eve on GitHub](https://github.com/vercel/eve) — view the source and contribute.

## Deploy on Vercel

Deploy your agent to [Vercel](https://vercel.com) from the project root:

```bash
eve deploy
```

`eve deploy` links a Vercel project if needed and deploys the agent to production. See the [eve deployment documentation](https://eve.dev/docs/guides/deployment/vercel) for authentication, environment variables, and deployment options.
