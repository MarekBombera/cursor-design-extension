# Keep comment drafts across a tab switch - Overview for review

Source of truth: `blueprint/history/fixes/keep-comment-drafts-across-a-tab-switch.md`. This file is the steering summary, not the build spec.

## TL;DR

Switching to another editor tab and back no longer loses what you were doing in the cursor-design panel. An open comment bubble, Comment mode, a half-typed new comment and half-typed replies all come back. The comment boxes also start at a usable 4-line height, and Alt+click picking the parent now has a permanent browser test.

## Key loop

```mermaid
sequenceDiagram
  participant User
  participant Chrome as Chrome (App)
  participant State as webview state (JSON)
  participant Host as Extension host
  User->>Chrome: type a comment / reply, open a thread
  Chrome->>State: setState (live value, or the held one while waiting; defaults and pending sends left out)
  Note over Chrome: tab hidden → webview destroyed → tab shown → rebuilt
  Chrome->>State: getState → parseSavedCommentUi
  Chrome->>Host: artboard:ready
  Host->>Chrome: canvas:updated → draft back if its frame is live
  Host->>Chrome: comments:updated → thread opens once its pin is placed
```

## What you will see

- An open pin thread is open again after a tab switch.
- Comment mode stays on, and the new-comment popover is back on the same element with your text, cursor at the end.
- Half-typed replies (in the Comments list or a bubble) are back.
- A comment already sending isn't restored, so there are no duplicates.
- Comment boxes start 4 lines tall.

## Decisions locked

- Draft text lives on the draft itself, so it can't leak into the next comment.
- Saved state is parsed like any wire value, and a broken key is dropped alone.
- Restores wait for their frame or pin, and are dropped if it never comes.
- A restore never steals focus from something you're typing in.
- The test harness copies state as JSON, like Cursor.

## Glossary

| Term | Why it exists |
|---|---|
| Webview state | The small record VS Code keeps for the panel while its tab is hidden; the panel is rebuilt from it |
| Held restore | A saved draft or thread waiting for its frame or pin to exist again before it reopens |

## Done means

`pnpm verify` (565), `pnpm test:browser` (134, 10 new reload tests incl. Alt+click) and `pnpm knip` are green. The three main restore tests fail with their restore code removed.
