# Lean export and helper sweep (fix) - Overview for review

Source of truth: `blueprint/history/fixes/lean-export-and-helper-sweep.md`. This file is the steering summary, not the build spec.

## TL;DR

Quality wave 1. Verify now runs knip in normal and production mode, so an export only tests use, or a dead one, fails the build. The 51 test-only exports found today are gone from module interfaces: 41 un-exported, 9 kept as tagged test seams, 1 pass-through re-export deleted. Twin helpers (`isFiniteNumber`, `isRecord` / `asRecord`, `PROVISIONAL_FRAME_HEIGHT`) now live once each, and passing tests stop printing error stacks. No behavior change.

## What you will see

- Nothing in the panel, the exported `canvas.html` or the Agent tools.
- `pnpm verify` runs `knip && knip --production`; adding `export` to an internal constant fails it.
- `pnpm test` output on a green run has no `DiskError` stack traces.

## Architecture decisions

- knip production mode marks the three bundle entries and the `src` project globs with `!`; `*.cases.ts` test tables are excluded.
- A test-only export is un-exported first (test asserts through the real interface), deleted second, kept with `/** @internal */` only when a test must pin it. The 9 keeps: the two MCP tool input schemas (Agent skill drift guard), `editableSections`, `isGeneratedName`, `buildSelector`, `textExcerpt`, `pinPoint`, `pinLabel`, `frameBounds`.
- `frameMessages.ts` owns `isFiniteNumber` and the array-accepting `isRecord`; disk's array-rejecting `isJsonRecord` stays a separate job. `stageGeometry.ts` owns `PROVISIONAL_FRAME_HEIGHT` for the panel and `canvas.html`.
- Exported types are out of scope: knip cannot gate them.

## Out of scope

Dispose-hooked flags, request preamble, panel refresh race, frame cache key, ports, `parseHostMessage`, comments restructure: build-plan item 11 (next: 11f test effectiveness review, then 11a).

## Done means

- `pnpm verify` green (836 unit tests, both knip runs), `pnpm test:browser` 209 pass.
- Mutation checks: re-exporting `HINT_UNCHECKED` or un-tagging `artboardToolInputSchemas` fails `knip --production`.
- Audit F-01..F-05 (all P3) fixed and closed by re-review.
