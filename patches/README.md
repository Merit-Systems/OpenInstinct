# Eve and Linq patches

Eve is pinned to the official, immutable `pkg.eve.dev` build at
`59ec96cc99f65a80f7a2daf4ca5e2a0ad95455f2` (`0.52.2+main.59ec96cc99f65a80`).
It includes the merged turn-context placement fix in
[vercel/eve#3089](https://github.com/vercel/eve/pull/3089), which is absent from
npm's `0.52.2` release. Return to a registry version once a release contains this
commit and the patches below have been checked against it.

The tarball SHA-256 is
`633c0d9ebf5d0d5733d8cc2fdc5315952a7ccca8cb7902c31f550dc8ab0750a9`.
The lockfile also records its package integrity. pnpm matches URL dependency
patches by package name, so keep the immutable dependency pin when changing the
Eve patch.

## Remaining patches

- `@linqapp__chat-sdk-adapter@0.5.1.patch` adds `replyToMessageId` to native
  message delivery, preserving attachments and idempotency keys.
- `eve@0.52.2+main.59ec96cc99f65a80.patch` applies that same reply option to the
  adapter Eve actually bundles. It also redirects incomplete bundled Linq and
  Chat SDK declaration exports to the explicitly installed packages. Eve's
  runtime still uses its bundled adapter and Chat SDK.

Remove reply changes when upstream Linq and Eve's bundled adapter both support
native replies. Remove declaration bridges when the published declaration
files resolve without them. `linq-bundled-adapter.test.ts` exercises Eve's actual
bundled runtime; `linq-message-delivery.test.ts` covers application delivery and
the separately installed adapter.

The old Eve patches for `ask_question` and `task_cancel` exports are no longer
needed: both now have public entry points. Callback authorization is composed
in `agent/channels/eve.ts` using public `defineChannel` and `routeAuth` APIs.
The Linq webhook verifier already converts an unsuccessful OIDC verification
into `false`, so the extra bundled null-verifier patch was redundant.

No task-loop or prompt-placement patch is applied locally.
