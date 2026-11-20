# Dependency compatibility patches

`@linqapp__chat-sdk-adapter@0.5.1.patch` adds the native reply option to
the separately installed adapter while preserving attachments and idempotency.
The channel sends native replies through that adapter without patching eve's
bundled copy.

The earlier `task_cancel` hunk is no longer needed: Eve 1.0 provides
`eve__task_cancel` itself for agents with task tools, including the resumable
`run_browser` tool.

Stripe Link purchases are disabled on this branch. No published
`@stripe/link-integrations-eve` release is built for Eve 1.0 (0.3.8 was built
with 0.79.0), and Eve 1.0 refuses to load extensions built with 0.83 or
earlier. See the README's Link wallet section for how to re-enable it.
