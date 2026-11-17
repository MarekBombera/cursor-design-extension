# Feature: Copy prompt

**From build-plan:** feature 8h
**Build attempt:** 1
**Branch:** feature/copy-prompt
**Status:** verified

## Goal

Every comment gets a **Copy prompt** button, in the Comments panel and in the pin thread. It
fills the Notion template, which is locked word for word, with that comment's fields. The host
writes the prompt to the clipboard with `vscode.env.clipboard.writeText`. Only after that write
succeeds does the host mark the comment `sent`.

One **Copy all open** button in the panel copies a single batch prompt. That prompt lists every
`open` comment id in `comments.json` order and marks those comments `sent` the same way. Bombic
confirmed the batch wording ("ids only") on 2026-11-17, and a literal test locks it like the
single template.

The user pastes the prompt into Cursor Agent chat. The Agent works only on the ids in it
(`get_comment`, `update_artboard`, `resolve_comment`). Nothing is sent to the Agent automatically,
and there is no prefilled chat.

## In scope

- `src/host/commentPrompt.ts` (pure, no `vscode`): `singleCommentPrompt(comment)` and
  `openCommentsPrompt(ids)`. A literal test pins each template.
- One shared one-line sanitizer, `toOneLine(value, cap)`, in `src/webview/frame/frameMessages.ts`
  next to `hasControlChars`.
- Two new chrome → host requests in the existing comment-request family:
  `comment:copy {requestId, id}` and `comment:copy-open {requestId}`.
  - Each attempt with a valid `requestId` is answered once, with either the new
    `ui:copied {requestId, count}` or `ui:error {requestId, message}`.
  - Every copy answer is followed by a `comments:updated` refresh.
- Host order: read from disk, build the prompt, `await vscode.env.clipboard.writeText`, then
  `markCommentsSent` (the existing disk function, which takes the lock and marks open comments
  only), then answer, then refresh.
- **Copy prompt** button on `CommentCard`, so it shows on both surfaces, for every status.
- **Copy all open (N)** button at the top of the panel's list. N is the number of `open` comments.
- One copy at a time across the whole chrome, so the last answer always matches the clipboard.
- Feedback for each copy:
  - a visible "Copied" label for 1.5 s;
  - a live-region announcement;
  - an inline error linked to its button.
- Rules 02 and 05 updated in this change.
- Unit tests and browser tests, plus the F5 list for Cursor-only behavior (real clipboard, paste
  into Agent chat). F5 is recorded at `/check`.

## Out of scope

- Prefilled Cursor chat or any automatic send (Notion out of scope).
- Changing the single template's words, or adding a page-comment variant. A page comment fills
  the same template through the same field rules (`Target: body ""`).
- Copying `sent` comments in the batch. "Copy all open" means status `open` only, and the plan says
  it skips resolved and sent comments.
- Any MCP tool, argument, error code, limit or CSP change. The `cursor-design` skill already says
  to act on ids from a pasted prompt and to stop on a resolved, stale or missing target. No skill
  edit is needed.
- Refactoring `comments.ts`'s `artboardLabel`. It sanitizes stored data with different rules (no
  collapse, no trim), and changing it would change what is written to disk.
- 8i work: the F5 dogfood of every Notion done-when line, the `.vsix` smoke, README and AGENTS
  status, and the hub hand-off.
- A keyboard shortcut for copy.

## Build loop

`workflow.stepReview: feature`: build every step, then one review at the end. Checkpoint commits
are disabled; `/complete` makes the commit.

- **After each step:** run `pnpm exec vp test` on the touched tests.
- **Steps 2 and 3:** each ends with `pnpm verify` green. It includes `svelte-check`, which `vp check`
  does not run.
- **Step 3:** also run `pnpm test:browser`.
- **Every `.svelte` edit:** follow rule 08. Read the Svelte MCP docs before writing, then run
  `svelte-autofixer` until clean (prefer the `svelte-file-editor` agent).
- **Before handoff:** `pnpm verify` and `pnpm test:browser` must both be green.

Work on `feature/copy-prompt`. Create it from `main` first: the spec files are uncommitted on
`main`.

## Build steps

- [x] **1. Prompt builder.**
  - `src/webview/frame/frameMessages.ts`: add `toOneLine(value: string, cap: number): string`
    next to `hasControlChars` (rule in Data / contracts → Field rules). The existing private
    `CONTROL_CHARS` stays as it is. `toOneLine` has its own global pattern, `/[\p{Cc}\p{Cf}\s]+/gu`.
    Its comment says the two must cover the same line breakers; `\s` covers U+2028 and U+2029.
  - New `src/host/commentPrompt.ts`, pure, no `vscode`:
    - `singleCommentPrompt(comment: Comment): string`
    - `openCommentsPrompt(ids: readonly string[]): string`. The caller never passes `[]`: the host
      answers `NOTHING_OPEN_MESSAGE` first.
    - Field rules exactly as in Data / contracts. Reuse `toOneLine`, `isSafeStyleValue`,
      `COMMENT_STYLE_KEYS`, `MAX_PICK_TEXT_CHARS` and `MAX_SELECTOR_CHARS`; write no other
      sanitizer.
    - One `ponytail:` comment on the body rule naming the accepted ceiling. The body is the user's
      own text, kept multi-line; a hand-edited or cloned `comments.json` can carry any words in
      it; the user reviews the text when pasting.
  - Tests: new `src/host/commentPrompt.test.ts`, plus `toOneLine` cases in
    `src/webview/frame/frameMessages.test.ts`, covering the cases in Testing. The expected prompt
    strings are literal copies of both templates with concrete values, typed out in the test file.
    They are never built from the module's constants and are never a snapshot.
  - `.claude/rules/05-single-job.md` owner catalog:
    - add `toOneLine` to the `frameMessages.ts` list;
    - add a host entry for `commentPrompt.ts` (`singleCommentPrompt` / `openCommentsPrompt`).
  - **Done when:** `pnpm exec vp test src/host/commentPrompt.test.ts
    src/webview/frame/frameMessages.test.ts` passes, and changing any word, space or line break of
    either template makes it fail.

- [x] **2. Host contract and clipboard path.**
  - `src/webview/hostMessages.ts`:
    - Add `CommentCopyMessage`, `CommentCopyOpenMessage` and `CopiedMessage` (Data / contracts).
    - `CommentRequestMessage` gains the two copy types.
    - `CopiedMessage` is exported for the host but **not yet** added to `HostMessage`. Step 3 adds
      it together with its parse and its App routing, so this step type-checks.
  - `src/host/chromeMessages.ts`:
    - Add both schemas to `chromeMessageSchema`. `id` must match `COMMENT_ID_PATTERN` and
      `requestId` must match `REQUEST_ID_PATTERN`.
    - `COMMENT_REQUEST_TYPES` gains both types, so `commentRequestType` and `commentRequestId`
      cover them without a twin.
    - `malformedRequestMessage` returns `COPY_FAILED_MESSAGE` for both copy types.
    - `commentRequestErrorMessage` maps errors as follows:
      - `CommentNotFoundError` → `COMMENT_GONE_MESSAGE` (unchanged);
      - any other domain error (`CursorDesignError`) → its own message through
        `toSafeArtboardErrorMessage` (busy, corrupt);
      - a non-domain error → the type's fallback, which is `COPY_FAILED_MESSAGE` for the copy
        types. A clipboard rejection takes this branch.
    - Add the constants in Data / contracts → Failure copy.
  - `src/host/panelComments.ts`:
    - `LOG_SCOPES` gains `panelComments.copy` and `panelComments.copyOpen`.
    - The exhaustive `switch` gains both cases, following Data / contracts → Host order exactly.
      Update the comment above it to say "a new comment request type fails to compile here".
    - For the copy types, `refuse` also runs `void postPanelComments({outputChannel})` after its
      `ui:error`, so every copy answer is followed by a refresh.
    - One `ponytail:` comment: `getComment` / `listComments` compute flags the prompt does not
      use, bounded by the shared 200 ms target-check budget and the parse cache. The upgrade path
      is a flag-free disk read.
  - `src/host/panelOutbox.ts` and `src/panel/openArtboardPanel.ts`: `postAnswer` and
    `postAnswerToPanel` accept `CopiedMessage`. The timing rule is unchanged: answers are posted
    only while ready and never replayed. `onDidReceiveMessage` already routes every
    `commentRequestType` claim to the handler.
  - `.claude/rules/02-mcp-webview.md` item 5: add `comment:copy { requestId, id }`,
    `comment:copy-open { requestId }` and `ui:copied { requestId, count }`. Same boundary and
    one-answer rule. The clipboard is written before `markCommentsSent`, and every copy answer is
    followed by `comments:updated`.
  - `.claude/rules/05-single-job.md`: the `answerCommentRequest` catalog line becomes "create,
    reply, set-status, copy, copy-open; one answer per attempt, posted before the refresh;
    clipboard before `markCommentsSent`; never wraps the disk lib's own lock".
  - Tests (cases in Testing):
    - `src/host/chromeMessages.test.ts`.
    - `src/host/panelComments.test.ts`:
      - The `vscode` mock gains `env.clipboard.writeText`, which pushes `clipboard` or rejects per
        test.
      - The `../disk/comments` mock gains `getComment` and `listComments` (both resolve fixtures)
        and `markCommentsSent`, which pushes `write:sent` and resolves the marked list per test.
  - **Done when:** the step-2 unit cases pass and `pnpm verify` is green.

- [x] **3. Chrome buttons.**
  - `src/webview/hostMessages.ts`:
    - `HostMessage` gains `CopiedMessage`.
    - `parseHostMessage` accepts `ui:copied` only when `requestId` is a string and `count` is a
      non-negative integer. Otherwise it returns undefined.
  - `src/webview/commentsPanel.ts` (pure rules):
    - **Pending copy state.** `CommentAction.pending` gains `{requestId, kind: 'copy'}`. New
      `CopyOpenState = {pending?: string; error?: string}`.
    - **`copyPending({actions, copyOpen}): boolean`.** True while any action has a pending copy or
      `copyOpen.pending` is set. Only one copy runs at a time across the chrome.
    - **`submitCopy({actions, copyOpen, id, requestId})`.** It sends nothing in two cases: while
      `copyPending`, and while any request for that comment is pending (same rule as status).
      Otherwise it sets the copy pending, clears that comment's `error`, and returns
      `{type: 'comment:copy', requestId, id}`.
    - **`submitCopyOpen({actions, copyOpen, openCount, requestId})`.** It sends nothing while
      `copyPending`, or when `openCount === 0`. Otherwise it returns `{pending: requestId}` (with
      `error` cleared) and `{type: 'comment:copy-open', requestId}`.
    - **`answerAction`** takes `CommentSavedMessage | CopiedMessage | UiErrorMessage` and returns
      `{actions, announcement?, copiedId?: string}`.
      - The answer must fit the pending kind. `ui:copied` matches only `kind: 'copy'`, and
        `comment:saved` only `reply` or `status`. A misfit or unmatched answer returns the same
        object.
      - The copy branch comes **before** the existing reply fallthrough. It clears `pending`,
        keeps `reply` and the composer untouched, and returns `copiedId` = that comment's id with
        the single-copy announcement.
      - `ui:error` keeps the existing branch: it sets `error` and announces the message.
    - **`answerCopyOpen({state, answer: CopiedMessage | UiErrorMessage})`.** Returns
      `{state, announcement?, copied: boolean}`.
      - A matching `ui:copied` clears `pending`. It returns `copied: true` and the batch
        announcement.
      - A matching `ui:error` clears `pending` and sets `error`. It announces the message, with
        `copied: false`.
      - A non-matching answer returns the same state, with `copied: false`.
    - **`copyAnnouncement({kind: 'single' | 'batch', count})`.** Returns the copy in Data /
      contracts → Chrome copy.
    - **`COPY_FEEDBACK_MS = 1500`.**
  - `CommentCard.svelte`: add a **Copy prompt** button (`type="button"`, `data-cd-focus="copy"`) in
    the action row, after Resolve / Reopen. It shows on both surfaces and for every status.
    - New props: `copyBlocked: boolean` (from `copyPending`, or anything pending for this
      comment), `copied: boolean` and `onCopy`.
    - While `copyBlocked`, the button is `aria-disabled` and its click does nothing.
    - While `copied`, its text reads **Copied**. Focus stays on it.
    - When `action.error` is set, the button gets `aria-describedby` pointing at the error, like
      the status button. The card has one error slot, so a copy failure is also described from
      Resolve. That is accepted: it is the latest failure for this comment.
  - `CommentThread.svelte` passes `copyBlocked`, `copied` and `onCopy` through.
  - `CommentsPanel.svelte` passes them per item, and renders a **Copy all open (N)** row above the
    groups:
    - The row shows only while the list renders (not in the error or empty state).
    - The button is `aria-disabled` when N is 0 or `copyPending`.
    - Its error shows below it, linked with `aria-describedby`.
    - Its label reads **Copied** while the batch feedback is live.
    - `restoreFocus` (in this file) already reads `data-cd-focus`, so `copy` survives a list
      update with no change there.
  - `App.svelte`:
    - **State.** Holds `copyOpen: CopyOpenState` and
      `copyFeedback: {key: string; sequence: number} | undefined`. `key` is the comment id, or
      `'*open'` for the batch; the id charset has no `*`.
    - **Handlers.** `handleCopy(id)` and `handleCopyOpen()` call the submit rules and post through
      the existing `postCommentRequest`.
    - **Routing.** `ui:copied` is handled with an early `return`, like `comment:saved`, before the
      `ui:status` fallthrough. It goes to `answerAction` and `answerCopyOpen`. `ui:error` also goes
      to `answerCopyOpen`; UUIDs never cross-match.
    - **On success.** App only applies what the rules return. A `copiedId` or `copied: true` sets
      `copyFeedback = {key, sequence: (copyFeedback?.sequence ?? 0) + 1}`. That replaces any other
      key's feedback and restarts the timer. App then announces.
    - **Timer.** One `$effect` clears `copyFeedback` after `COPY_FEEDBACK_MS`, with the same cleanup
      pattern as the jump flash.
    - `comments:updated` never clears `copyOpen.pending`, because the answer always comes first.
      `keepLiveActions` still drops a deleted comment's action, including its pending copy.
  - `.claude/rules/05-single-job.md`: add `copyPending` / `submitCopy` / `submitCopyOpen` /
    `answerCopyOpen` / `copyAnnouncement` / `COPY_FEEDBACK_MS` to the `commentsPanel.ts` list.
  - Browser tests: extend `tests/browser/commentsPanel.spec.ts` with the cases in Testing.
  - **Done when:** the step-3 unit cases pass, `pnpm test:browser` passes, and `pnpm verify` is
    green.

- [x] **4. Verify.**
  - Run `pnpm verify` and `pnpm test:browser`.
  - Run `pnpm knip` and confirm there is no new unused export.
  - Re-read rules 02 and 05 against the shipped code.
  - **Done when:** both commands are green. The F5 list stays for `/check`.

## Files / areas

- **New:** `src/host/commentPrompt.ts` and `src/host/commentPrompt.test.ts`.
- **Shared sanitizer:** `src/webview/frame/frameMessages.ts` (+ test), which gains `toOneLine`.
- **Host:**
  - `src/host/chromeMessages.ts` (+ test)
  - `src/host/panelComments.ts` (+ test)
  - `src/host/panelOutbox.ts` (type only)
  - `src/panel/openArtboardPanel.ts` (type only)
- **Shared types:** `src/webview/hostMessages.ts` (+ test).
- **Chrome:**
  - `src/webview/commentsPanel.ts` (+ test)
  - `src/webview/CommentCard.svelte`
  - `src/webview/CommentThread.svelte`
  - `src/webview/CommentsPanel.svelte`
  - `src/webview/App.svelte`
- **Browser:** `tests/browser/commentsPanel.spec.ts`. Touch `tests/browser/harness.ts` only if it
  cannot already capture posted requests and post host messages. It does both for 8g.
- **Rules:** `.claude/rules/02-mcp-webview.md` and `.claude/rules/05-single-job.md`.
- **Unchanged:**
  - `src/disk/comments.ts` (`markCommentsSent`, `getComment` and `listComments` already exist)
  - MCP tools
  - `skills/cursor-design/SKILL.md`

## Data / contracts

### Single template (Notion, locked word for word)

Seven lines joined with `\n`, with no trailing newline:

```txt
Handle cursor-design comment {id} only.
First call get_comment("{id}"). If it is resolved, stale or the target is missing, stop and tell me.
Artboard: {artboard} (frame {frameId}, version {version})
Target: {selector} "{text}"
Current styles: {styles}
Comment: {body}
Make the change with update_artboard, then call resolve_comment("{id}", note) with a one-line note of what you changed.
```

### Batch template (Bombic 2026-11-17, locked word for word)

Joined with `\n`, with no trailing newline.

- There is one `- {id}` line per id, in the order given.
- The `{id}` in the last two lines is literal text: it stays in the prompt and is never filled in.
- A single open comment still gets this template, with one bullet.

```txt
Handle these cursor-design comments, in this order:
- {id1}
- {id2}
For each id: first call get_comment("{id}"). If it is resolved, stale or the target is missing, skip it and tell me at the end.
Otherwise make the change with update_artboard, then call resolve_comment("{id}", note) with a one-line note of what you changed.
```

### Field rules

The goal: frame-sourced text can never forge a template line, or visually reorder the pasted text.
A design's own script can post any `cd:pick`. These rules cover the free-text fields only. The
identifier fields are already validated by the `comments.json` parse (`COMMENT_ID_PATTERN`,
`parseArtboardId`, integer `version`), so they are filled in verbatim.

`toOneLine(value, cap)` runs four steps in order:
1. Replace each run of `[\p{Cc}\p{Cf}\s]` with one space. This covers newlines, tabs, U+2028 and
   U+2029, and bidi overrides such as U+202E.
2. `trim()`.
3. Cut to `cap` UTF-16 code units. If the last kept unit is a high surrogate (U+D800–U+DBFF), drop
   it, so no lone surrogate reaches the clipboard.
4. `trimEnd()`.

| Placeholder | Source | Rule |
|---|---|---|
| `{id}` | `comment.id` | Verbatim (parse-validated `COMMENT_ID_PATTERN`) |
| `{artboard}` | `comment.artboard` | `toOneLine(…, MAX_PICK_TEXT_CHARS)` |
| `{frameId}` | `comment.frameId` | Verbatim (parse-validated artboard id) |
| `{version}` | `comment.version` | `String(integer)` |
| `{selector}` | `comment.selector` | `toOneLine(…, MAX_SELECTOR_CHARS)` |
| `{text}` | `comment.text` | Remove every `"`, then `toOneLine(…, MAX_PICK_TEXT_CHARS)` |
| `{styles}` | `comment.styles` | See below |
| `{body}` | `comment.body` | Replace every `\p{Cc}` character except `\n` with a space. Otherwise verbatim, newlines kept: it is the user's own text (`ponytail:` ceiling above) |

`{styles}`:
- Walk `COMMENT_STYLE_KEYS` in order. Keep a key only when its value is a string that passes
  `isSafeStyleValue`.
- Format each as `key: value` and join with `; `, with no trailing `;`.
- No styles gives the empty string, so the line reads `Current styles: ` with a trailing space,
  exactly as the template fills.

Page comments go through the same rules. The picker stores `selector: 'body'` and `text: ''`, so
the line reads `Target: body ""`.

### Messages

Chrome → host. Both are untrusted, and both go through the same boundary as `comment:reply`. Each
attempt with a valid `requestId` gets exactly one answer:

```ts
type CommentCopyMessage = { type: 'comment:copy'; requestId: string; id: string };
type CommentCopyOpenMessage = { type: 'comment:copy-open'; requestId: string };
```

Host → chrome:

```ts
// count = comments this copy moved from open to sent (0 for a sent or resolved comment, or when
// the Agent resolved them first). Posted before the comments:updated it causes.
type CopiedMessage = { type: 'ui:copied'; requestId: string; count: number };
```

This deliberately differs from the 0.3 plan's `comment:copy {id}` / `ui:copied {count}`: the copy
messages carry a `requestId`, and so does every `ui:error` for a copy. 8g learned that without one,
a failure cannot be tied to the button that sent it, and the button stays stuck.

### Host order (`answerCommentRequest`)

The existing steps stay as they are: requestId (none means log and return, no answer), trust,
folder, parse. Every `ui:error` below goes out through `refuse`: logged once under the type's
scope, then the answer, then the refresh (copy types only).

`comment:copy`:
1. `comment = await getComment({workspaceRoot, id})`. An unknown id throws `CommentNotFoundError`,
   so the answer is `COMMENT_GONE_MESSAGE`.
2. `prompt = singleCommentPrompt(comment)`, for any status (Notion: every comment has the
   button).
3. `await vscode.env.clipboard.writeText(prompt)`. A rejection reaches the outer catch, and the
   answer is `COPY_FAILED_MESSAGE` (the non-domain fallback). Nothing is written.
4. `marked = await markCommentsSent({workspaceRoot, ids: [comment.id]})`, in its own
   `try`/`catch`. Any throw (busy, corrupt, anything) → `refuse(COPIED_NOT_MARKED_MESSAGE,
   error)`, and the handler returns. The typed message is logged only.
5. `ui:copied {requestId, count: marked.length}`, then `void postPanelComments({outputChannel})`.

`comment:copy-open`:
1. `{comments} = await listComments({workspaceRoot, status: 'open'})`. If it returns zero
   comments, call `refuse(NOTHING_OPEN_MESSAGE, …)` and return. There is no clipboard write and
   no disk write, and the refresh corrects a stale N.
2. `ids = comments.map((c) => c.id)` in the returned (file, so creation) order.
   `prompt = openCommentsPrompt(ids)`.
3. The clipboard write works as in single copy, step 3.
4. `marked = await markCommentsSent({workspaceRoot, ids})`, with the same inner `try`/`catch` as
   single copy, step 4. Only comments still `open` under the lock change, so a racing Agent
   `resolve_comment` stays `resolved`.
5. `ui:copied {requestId, count: marked.length}`, then the refresh.

UI text never includes a stack or an absolute path.

### Failure copy (constants in `chromeMessages.ts`)

- `COPY_FAILED_MESSAGE = 'Could not copy the prompt. Check the Output panel: Cursor Design.'`.
  This is the copy types' fallback and their malformed copy.
- `COPIED_NOT_MARKED_MESSAGE = 'The prompt was copied, but the comment status was not updated. Try again.'`
- `NOTHING_OPEN_MESSAGE = 'There are no open comments to copy.'`
- Existing copy covers the rest: `COMMENT_GONE_MESSAGE`, `UNTRUSTED_WORKSPACE_MESSAGE`,
  `NoWorkspaceError`, and domain errors (busy, corrupt) through `toSafeArtboardErrorMessage`.

### Chrome copy (`copyAnnouncement`)

- **Single:** `count === 1` → "Prompt copied. Comment marked sent."; `count === 0` →
  "Prompt copied."
- **Batch:**
  - `count === 0` → "Prompt copied."
  - `count === 1` → "Prompt copied. 1 comment marked sent."
  - otherwise → "Prompt copied. {count} comments marked sent."
- **Labels:** **Copy prompt** and **Copy all open (N)**. Each reads **Copied** while its own
  `copyFeedback` is live.
- **Errors:** announced with the error message, and shown inline under their button.

### Status machine (unchanged, 8e)

A comment goes from `open` to `sent` only through `markCommentsSent`, which only this copy path
calls. A copy never changes a `sent` or `resolved` comment.

## Testing

- **Unit (`vp test`).** Edge cases over volume (rule 09). Each must fail when its guard is
  deleted.
  - `toOneLine`:
    - a newline, a tab, U+2028 and U+202E each collapse into one space;
    - the result is trimmed;
    - a cap that falls inside an emoji leaves no lone surrogate and no trailing space.
  - `commentPrompt`:
    - The exact single template for an element comment, as a literal string.
    - The exact batch template for 3 ids and for 1 id.
    - `{text}` containing `"`, a newline and 300 characters comes out with no quotes, on one line,
      and capped.
    - `{selector}` and `{artboard}` with an embedded `\n` followed by forged template text stay on
      one line.
    - `{styles}`:
      - order follows `COMMENT_STYLE_KEYS`, not the stored key order;
      - a disallowed key and an unsafe value are dropped;
      - empty styles give `Current styles: ` with a trailing space.
    - A multi-line `{body}` keeps its newlines, and a NUL in it becomes a space.
    - A page comment gives `Target: body ""`.
  - `chromeMessages`:
    - Both copy types parse.
    - A bad id or a missing `requestId` is rejected.
    - `commentRequestType` and `commentRequestId` cover both types.
    - `commentRequestErrorMessage` for `comment:copy`:
      - `CommentNotFoundError` → `COMMENT_GONE_MESSAGE`;
      - `LockTimeoutError` → its own message;
      - a plain `Error` → `COPY_FAILED_MESSAGE`.
  - `panelComments` (ordered `host.calls`):
    - **Single success:** `clipboard`, `write:sent`, `answer:ui:copied`, `comments:updated`, in
      that order.
    - **Batch success:** the same order. The batch passes ids in the order `listComments`
      returned.
    - **Clipboard rejects:** `answer:ui:error` with `COPY_FAILED_MESSAGE`, no `write:sent`, then
      `comments:updated`.
    - **`markCommentsSent` throws `LockTimeoutError`:** `COPIED_NOT_MARKED_MESSAGE`, then
      `comments:updated`.
    - **Zero open:** `NOTHING_OPEN_MESSAGE`, no `clipboard`, then `comments:updated`.
    - **Unknown id:** `COMMENT_GONE_MESSAGE`, no `clipboard`.
    - **Untrusted workspace:** a refusal, with no `clipboard`.
    - **Count:** `count` equals the length `markCommentsSent` returned (2 of 3 still open).
  - `hostMessages`: a `ui:copied` with no `requestId`, or with a negative or fractional `count`, is
    dropped.
  - `commentsPanel`:
    - `submitCopy` on comment B while a copy on A is pending sends nothing.
    - `submitCopy` while a status request for the same comment is pending sends nothing.
    - `submitCopyOpen` while a card copy is pending, with `openCount` 0, or while itself pending,
      sends nothing.
    - A new submit clears the previous `error`.
    - A copy answer leaves `reply` intact and returns `copiedId`.
    - `comment:saved` with a copy's `requestId` returns the same object.
    - A non-matching answer returns the same object or state.
    - `copyAnnouncement` for single 0 and 1, and batch 0, 1 and 3.
  - Disk: the existing `markCommentsSent` tests (open only, unknown ids skipped) stay. They cover
    "skips resolved and sent" and the racing resolve.
- **Browser (`pnpm test:browser`, `tests/browser/commentsPanel.spec.ts`).** Assert through roles,
  `data-cd-*` hooks and captured posted messages, never pixels. Use Playwright's `page.clock` for
  the 1.5 s label, never a real wait.
  - **Single copy.** Copy prompt on a panel card posts one `comment:copy {requestId, id}`.
    - A second click on it posts nothing while it is pending, and so does Copy prompt on another
      card.
    - After `ui:copied {count: 1}`:
      - the button reads Copied and keeps focus;
      - the live region reads "Prompt copied. Comment marked sent.";
      - after advancing the clock 1.5 s, the label reads Copy prompt again.
    - A typed reply in that card's open composer survives the answer.
  - **Single copy error.** A `ui:error` with that `requestId` shows the error, linked to Copy
    prompt by `aria-describedby`. A `ui:error` with another id changes nothing.
  - **Where Copy prompt shows.** It shows in the pin thread, and on resolved and sent cards.
  - **Copy all open:**
    - It reads `(2)` with 2 open comments and 1 sent comment, and posts `comment:copy-open`.
    - With 0 open comments it is `aria-disabled`, and a click posts nothing.
    - `ui:copied {count: 2}` announces "Prompt copied. 2 comments marked sent.".
    - Its `ui:error` shows under it, linked to it.
  - **Focus.** With focus on a card's Copy prompt, a `comments:updated` that flips that comment to
    sent keeps focus on that comment's Copy prompt.
- **F5 (Cursor-only: real clipboard and Agent chat), recorded at `/check`:**
  1. Copy prompt on an open element comment, then paste into Agent chat. The text equals the
     template with that comment's values, and the card and pin show Sent to Agent.
  2. Copy all open with 3 open comments pastes 3 ids in creation order, and all three turn Sent.
  3. Copy a comment the Agent already resolved. The paste works, the comment stays Resolved, and
     the announcement says "Prompt copied.".
  4. Send the pasted batch to the Agent. It handles each id, and its notes appear as replies (the
     Notion done-when loop; 8i repeats it end to end).
- No clipboard-failure evidence is claimed from F5; only the unit mock covers the rejection.

## Notes for the AI

- Read `blueprint/reference/0.3-comments-plan.md` → "8h" and "8g as shipped" first. This spec
  overrides the plan where they differ: the copy messages carry a `requestId`.
- **Do not paraphrase either template.** Copy both from this spec into the test file by hand. If a
  lint or format rule reflows a template string, change the code layout (an array of lines joined
  with `\n`), never the words.
- Reuse, don't twin:
  - the answer path is `answerCommentRequest`'s switch and its `refuse`;
  - the disk reads are `getComment` / `listComments`, and the write is `markCommentsSent`;
  - the sanitizers are `toOneLine` / `isSafeStyleValue`;
  - the focus restore and the live region are 8g's;
  - the feedback timer copies the jump-flash `$effect` pattern.
- `markCommentsSent` takes the lock itself, and the two reads need none. Never wrap any of them in
  `withWorkspaceLock`.
- Decisions belong in `commentsPanel.ts`. App only applies the returned `actions`, `state`,
  `copiedId` / `copied` and `announcement` (rule 08).
- Ceiling: if the host dies between a request and its answer, the copy stays pending and every
  Copy button stays blocked until reload. That is the same `ponytail:` as 8g's lost answer; extend
  that comment rather than adding a new mechanism.
- The `vscode` import stays in `panelComments.ts`. `commentPrompt.ts`, `chromeMessages.ts` and
  `frameMessages.ts` stay `vscode`-free (lint).
- Svelte: follow the rule 08 workflow on every `.svelte` edit. Use `aria-disabled`, not `disabled`,
  so focus never drops.
- Run `pnpm verify` before handoff; do not skip it.

## Open questions

None. The batch prompt wording was the one open item: the plan said to confirm it with Bombic
before the 8h spec. He answered on 2026-11-17 with the "ids only" wording above.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":30522,"specSha256":"a7b9059c149fc7eebd472296a03e26eaf90bf1a2486ac7502a969c27bbba413e","branch":"refs/heads/feature/copy-prompt","head":"9304fecf1b8acb5135d7ffb313d853583ce23dbc","baseRef":"refs/heads/main","baseCommit":"583bb931575188aa7b4e8b0ac16337fa0a496416","sourceTree":"4e219a8027a0c53a73c918ab266ebfe28f72dea0","landing":"local-merge","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 9304fecf1b8acb5135d7ffb313d853583ce23dbc
**Base commit:** 583bb931575188aa7b4e8b0ac16337fa0a496416
**Base ref:** main
**Spec hash:** a7b9059c149fc7eebd472296a03e26eaf90bf1a2486ac7502a969c27bbba413e
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-17T10:12:54Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-17T10:16:30Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain`: pass (HEAD = target, merge base = base, spec hash matches, tracked spec, only `review.md` dirty)
- `pnpm verify`: pass (vp check 126 files clean, agent rules check, svelte-check, webview test tsc, vp test 39 files / 512 tests, vp pack, webview build)
- `pnpm test:browser`: pass (110 Playwright Chromium tests, including the six new 8h cases in `tests/browser/commentsPanel.spec.ts`)
- `pnpm knip`: pass (no unused files, exports or dependencies)

### Evidence

- Full delta `583bb93..9304fec` read (25 files): host `commentPrompt.ts`, `chromeMessages.ts`, `panelComments.ts`, `panelOutbox.ts`, `openArtboardPanel.ts`; shared `hostMessages.ts`, `frame/frameMessages.ts`; chrome `commentsPanel.ts`, `App.svelte`, `CommentCard.svelte`, `CommentThread.svelte`, `CommentsPanel.svelte`; all unit and browser test diffs; rules 02 and 05.
- Host order matches the spec: `getComment` / `listComments`, then `vscode.env.clipboard.writeText`, then `markCommentsSent` in its own try/catch (`COPIED_NOT_MARKED_MESSAGE`), then `ui:copied`, then the refresh. Every copy `refuse` also refreshes, and no path answers twice (panelComments.ts:101-197).
- Trust boundary: both copy messages are zod-validated (`REQUEST_ID_PATTERN`, `COMMENT_ID_PATTERN`) and refused in untrusted workspaces. `frameId` verbatim is safe because `preparedTarget` runs `parseArtboardId` on every stored comment (src/disk/comments.ts:264-275). Frame-sourced `selector`, `text` and `artboard` go through `toOneLine`, which collapses Cc, Cf (bidi) and `\s` (U+2028/2029), so no template line can be forged. The verbatim multi-line body is user-authored and carries the spec's `ponytail:` ceiling.
- `markCommentsSent` changes only comments still `open` under the lock and skips the write when none changed, so re-copying a sent or resolved comment writes nothing (src/disk/comments.ts:712-743).
- Both templates match the spec word for word. `commentPrompt.test.ts` pins them as hand-typed literals, not built from the module.
- Chrome rules: one copy at a time (`copyPending`), answers matched by kind and requestId, `comments:updated` never clears the batch's pending state, and the `copyFeedback` timer follows the jump-flash `$effect` cleanup pattern. Buttons use `aria-disabled` and are linked to their errors with `aria-describedby`.
- Tests: each guard named in the spec has a case that fails when the guard is removed (quote strip, one-line collapse, surrogate cut, style order and filter, body control chars, host call order, clipboard rejection, mark failure, zero open, gone id, untrusted, count). No skipped or focused tests found in the delta.

### Findings

- F-91 [P3] open: the host's copy-type check twins chromeMessages' private `isCopyType` (src/host/panelComments.ts:105)
- F-90 [P3] unverified: re-examined and unchanged (new note in the ledger)

### Remaining risk

- `/check` and the F5 list (real clipboard, paste into Agent chat, Extension Host CSP) were not run: Check was not required by this request, and F5 needs a human in Cursor.
- A clipboard rejection is covered only by the unit mock, as the spec states.
- The batch prompt's `listComments` call computes target flags the prompt never uses. This is bounded by the 200 ms check budget and recorded as a `ponytail:` ceiling in panelComments.ts. No profile was run.
