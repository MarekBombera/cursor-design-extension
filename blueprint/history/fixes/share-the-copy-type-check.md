# Fix: Share the copy-type check

**Type:** Fix
**Status:** verified
**Branch:** fix/share-the-copy-type-check
**Fixes:** F-91

Follow-up from the independent review of 8h Copy prompt. The user approved this exact scope ("fix it and merge") and it goes straight to `/implement`, with no spec-review round.

## The problem

`refuse` in `src/host/panelComments.ts` spells out `type === 'comment:copy' || type === 'comment:copy-open'` again. `src/host/chromeMessages.ts` already owns that rule, as the unexported `isCopyType`, which `fallbackMessage` and `malformedRequestMessage` use. A future copy request type would have to be added in both places, or its failures would stop being followed by the `comments:updated` refresh. No current behavior is wrong.

## The fix

- Export `isCopyType` from `chromeMessages.ts`.
- Use it in `refuse`.
- Add it to the rule 05 owner catalog.

No behavior changes. Nothing else moves.

## Build steps

- [x] **1. One copy-type rule.**
  - `chromeMessages.ts`: `export const isCopyType`, with an exported return type.
  - `panelComments.ts`: `refuse` calls `isCopyType(type)`.
  - `.claude/rules/05-single-job.md`: list `isCopyType` with the comment request copy helpers.
  - **Done when:** `grep "comment:copy-open'" src/host/panelComments.ts` finds only the `LOG_SCOPES` key and the exhaustive switch's `case` label. The existing `panelComments.test.ts` copy-failure tests still show `comments:updated` after every copy `ui:error`. `pnpm verify` is green.

## Verify

- `pnpm verify`. The copy-failure cases in `src/host/panelComments.test.ts` (clipboard rejects, mark fails, zero open, gone id, untrusted) assert the refresh, so they fail if `isCopyType` stops matching a copy type.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":1720,"specSha256":"6f52d21ee9ba6add12fe454471242cceb2caaef1cf50a5daed2e3c67ab8102bb","branch":"refs/heads/fix/share-the-copy-type-check","head":"c102acd1368c67753ef4b0e0fe183f19791cd29a","baseRef":"refs/heads/main","baseCommit":"c102acd1368c67753ef4b0e0fe183f19791cd29a","sourceTree":"a48b2636bcc40e52b20a49b94240aafa66dfb1df","landing":"local-merge","absentOptional":[]} -->
