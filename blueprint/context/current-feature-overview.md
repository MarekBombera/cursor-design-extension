# Share the copy-type check - Overview for review

Source of truth: `blueprint/history/fixes/share-the-copy-type-check.md`. This file is the steering summary, not the build spec.

## TL;DR

Follow-up to the 8h independent review (F-91). "Is this a copy request?" now has one owner: `isCopyType` in `chromeMessages.ts`. The host's error path reuses it instead of spelling out both copy types again, so a future copy type can't silently lose the refresh that follows a failed copy.

## What you will see

Nothing new. Copy prompt and Copy all open behave exactly as in 8h.

## Done means

| Check | Result |
|---|---|
| `pnpm verify` | 512 unit tests; the copy-failure tests still assert the refresh |
| F-91 | `fixed`, stays in the ledger until an `/audit` closes it |
