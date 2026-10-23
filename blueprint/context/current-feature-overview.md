# Audit quality cleanup - Overview for review

> **Generated file.** Human-facing steering summary of the active work item:
> same content as `current-feature.md`, trimmed. Written at `/feature` when the
> spec is created, and kept current if the spec is revised. `/complete` may
> polish this into the archive-ready one-pager; it is not the first write.
> Open in Markdown preview to render the diagrams.

Source of truth: `blueprint/history/fixes/audit-quality-cleanup.md`. This file is the steering summary, not the build spec.

## TL;DR

A structure-only cleanup from the 2026-10-23 full quality audit. There is no new feature. The
host now writes through the disk library (so its writes get the symlink and ownership checks),
the 1278-line `artboardFs.ts` is split by job, and the panel message queue and the remaining App
decisions are pure modules with edge-case tests. The largest source file is now 473 lines.

## What changed

| Batch | Commit | Result |
|---|---|---|
| Disk consolidation | `eeb00cd` | Host goes through the disk lib; `artboardFs` split into `layoutFs`, `canvasView`, `exportFs` |
| Cleanup | `91bb025` | Twin helpers, `generation.ts` and dead exports removed; `knip` reports exports and types |
| Extractions | `a1700a9` | Tested `createPanelOutbox`; export reuses the stage layout |
| Webview rules | `28e56e1` | Wheel, frame-height, tile and outline rules leave App (354 → 302 script lines) |

## What you will see

Nothing new in the UI. Default-artboard setup is stricter: a symlinked `artboard.html` is
refused, and a `meta.json` with the wrong id is no longer overwritten (MCP already behaved this
way).

## Decisions locked

- Deciding logic lives in pure modules with edge-case tests (rule 08), host included.
- `artboardFs.ts` re-exports the old names, so no import paths changed.
- Stage's pointer-capture code waits on the F-26 F5 repro.

## Done means

`pnpm verify` green with 286 tests (272 before), `knip` clean, F5 passed, and a fresh independent
review passed and closed 11 findings. Open follow-ups: F-38 (createArtboard init test), F-39 (spec
note), plus the older F-09, F-14, F-15, F-16, F-25, F-26, F-28.
