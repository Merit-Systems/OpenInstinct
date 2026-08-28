# Repository-owned Oxlint rules

The `next` plugin is a local adaptation of the Next.js architecture rules from
the Merit Systems Foundation repository at commit
`712131d17f4089097c4636e0dc924be1a108cb96`.

It is kept local because this public repository cannot depend on Foundation's
internal packages. The adaptation supports both root-level `app/` and
`src/app/` Next.js projects. Rule activation belongs in the root
`.oxlintrc.jsonc`.
