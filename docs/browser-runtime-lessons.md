# Browser runtime lessons from BELL

Reviewed [BELL Stack](https://github.com/browserbase/bell-stack/tree/89954b6429ce65dbb0a15646f08a993427d732f4)
at commit `89954b6`. That snapshot uses Eve 0.79.1 and Browserbase/Stagehand.
OpenInstinct keeps Kernel, Eve 1.0, workspace-scoped browser ownership, and its
dedicated browser worker.

## Adopted

| BELL practice                                                                     | OpenInstinct adaptation                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release hosted browsers when a conversation ends, including from a fresh process. | A native `session.ended` worker hook looks up that worker's browser records and retires them. Ordinary turn completion and cancellation leave the worker available for continuation.                                                |
| Keep provider identifiers when release fails.                                     | Ownership records are removed only after Kernel confirms deletion or absence. A failed release is reported and remains discoverable for recovery. Cleanup uses a fresh timeout rather than the ended session's cancellation signal. |
| Reject unsafe navigation URLs before using the provider.                          | `manage_browsers` accepts only HTTP(S) launch URLs without embedded credentials. Both the tool schema and execution boundary enforce the rule.                                                                                      |
| Make live provider regressions opt-in and fail when cleanup fails.                | A Kernel check writes a synthetic cookie into a temporary profile, retires the writer, restores it in a read-only browser, and verifies retirement and cleanup.                                                                     |

## Existing strengths retained

BELL's Context metadata is scoped to one trusted operator and process. Our
workspace database and profile writer lock already support user isolation and
concurrent readers. The existing server-side vault fill and screenshot masking
remain in place. Kernel telemetry already leaves network, console, CDP,
interaction, and screenshot capture off by default; page navigation is enabled
for domain summaries.

## Useful follow-ups

BELL's expiring handoff links and post-payment browser quarantine are worth
adapting separately. A handoff should use our authenticated workspace boundary.
Payment quarantine needs a checkout operation that owns filling, submission,
and reconciliation together, so ordinary browser tools cannot inspect payment
fields afterward. Copying the quarantine in isolation would break the current
fill-then-submit flow. Link remains disabled until its integration supports our
Eve version.

BELL's separate task-state reducer and local Context file are unnecessary here;
Eve's native projection and our database remain the owning sources of state.

## Live Kernel check

```sh
OPENINSTINCT_LIVE_BROWSER_CHECK=1 pnpm test:browser:live
```

This uses real Kernel resources and the ignored `.env.local` configuration. It
creates a uniquely named test profile and two short-lived browsers, touches no
saved user profile or vault, and makes no website purchase or account change.
The cookie belongs to a reserved `.invalid` origin; no external website is
needed. Without the explicit flag, the command skips before starting the Kernel client or making provider calls.

Cleanup runs even when verification fails. If browser release fails, the check
retains the temporary profile for recovery, prints its unique name, and exits
with an error. A skipped check does not establish provider behavior. This checks
the provider's profile and retirement contract; the worker hook has separate
credential-free regression coverage.
