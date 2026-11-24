# Fix: Page ops P3 follow-ups - Overview for review

Source of truth: `blueprint/history/fixes/page-ops-p3-follow-ups.md`. This file is the steering
summary, not the build spec.

## TL;DR

Closes the four P3s left after 10c, with no product change:

- **F-05:** the dead `sc-` selector prefix is gone (finder never let it through).
- **F-29:** a test now proves that when another process takes page-2 first, `create_page` makes page-3.
- **F-30:** the "missing folder lists nothing" read lives once, as `readdirOrEmpty` in `layoutFs.ts`.
- **F-31:** the 0.5 plan records how blank page-1 adoption really works; the archived 10c spec stays as history.

## Done means

`pnpm verify` green (68 files, 844 unit tests); a fresh reviewer closed all four, with a mutation
probe on F-29. F-20 (`list_pages` speed, unmeasured) stays the only ledger entry.
