# Feature: Watcher pure step

**From build-plan:** feature 11c3
**Build attempt:** 1
**Branch:** feature/watcher-pure-step
**Status:** verified (steps 1-2 built; probes a-j red; `pnpm verify` passed 2026-11-27: 75 files, 927 tests)

## Goal

The disk watcher's decisions move out of `src/host/watchArtboardDisk.ts` into one pure function,
`stepWatch`, in a new `src/host/watchStep.ts` with no `vscode` import, and that function gets the
watcher's first test. The decisions are: skip lock and temp paths, track the `.ensure-panel`
marker, restart the 200 ms debounce, drop a run after a folder change or a trust loss, and pick
between a plain refresh and opening the panel. `watchArtboardDisk.ts` keeps only the thin vscode
shell: the `FileSystemWatcher`, the debounce timer, the serial run chain, the marker stat and
delete, and the calls to `openArtboardPanel` and `refreshPanel`.

Behavior is unchanged. Every old branch maps to exactly one transition row (Data / contracts:
Equivalence), including the ones that look odd. The one difference with no effect: trust is read
on every settled run instead of only on a pending one (Shell, item 4).

## In scope

- New `src/host/watchStep.ts`: `IDLE_WATCH_STATE`, `stepWatch(state, event)` and the
  `WatchEvent` type, pure (no `vscode`, no I/O, no timers, no module state). It imports
  `isLockOrTempPath` from `src/disk/workspaceLock.ts` (the one lock/temp rule; never a twin).
- New `src/host/watchStep.test.ts`: the watcher's first test, one Vitest file, no mocks.
- `src/host/watchArtboardDisk.ts` rewired onto `stepWatch`: `pendingMarkerEnsure` is replaced by
  one module-level `watchState`, and every branch inside the watcher callbacks, the debounced run
  and the rearm goes through `stepWatch`. The two setup guards at the top of
  `replaceArtboardWatcher` (trust, first folder) stay where they are.
- Rule 05 (`.claude/rules/05-single-job.md`), Host section, two literal edits:
  - The heading's no-`vscode` list gains `watchStep` after `refreshPanel`:
    `` …, `artboardDisk`, `refreshPanel`, `watchStep`): ``
  - In the `hostFs.ts` bullet, `` `watchArtboardDisk.ts` → the disk watcher; `` becomes
    `` `watchArtboardDisk.ts` → the disk watcher shell (vscode watcher, 200 ms timer, run chain, marker stat and delete); `watchStep.ts` → the one watcher decision `stepWatch` (lock / temp skip, `.ensure-panel` marker, debounce, folder and trust drops); ``

## Out of scope

- Any behavior change, including the edge races listed under Notes for the AI. They stay as they
  are; a fix is a separate `/fix`.
- A watcher factory or per-watcher instance (the module-level singletons stay). The Quality pass
  header keeps "host singleton factories (except the watcher)" open, but the 11c3 line Bombic
  approved (2026-11-23 waves) asks only for "a pure step with its first test" and a thin shell, and
  the section says "behavior unchanged unless an item names a bug". A per-watcher instance would
  change the shared-state race in Notes, so it would need its own item. The build plan stays as is.
- Clock injection or a fake timer seam (dropped by the 11 review), and a unit test of the vscode
  shell.
- `extension.ts`, `handleOpenArtboard.ts`, `refreshPanel.ts`, `hostFs.ts`, `openArtboardPanel.ts`:
  their calls into the watcher keep the same exports and arguments (`replaceArtboardWatcher`,
  `ensureArtboardWatcher`, `disposeArtboardWatcher`).
- The page-bound post port (11c4), `parseHostMessage` (11d), comments (11e).
- System map, Agent skill, README, browser tests, `pnpm gallery`: nothing they describe changes.
  The map's "200ms debounce, skips .lock / *.tmp" stays true.

## Build loop

`workflow.stepReview: feature`: build both steps, then present the whole feature for review once.
`workflow.checkpointCommits: disabled`: no commit per step; `/complete` makes the one commit.
Iterate with `pnpm exec vp test run src/host/watchStep.test.ts`; run `pnpm verify` once after
step 2 (`knip --production` flags `watchStep.ts` until step 2 imports it, so Verify is not a step
1 gate).

Probes (step 1's done-when): `watchStep.ts` is new and untracked, so `git checkout` cannot restore
it. Before the first probe, copy it to the session scratchpad. For each probe, apply the named
change, run only `watchStep.test.ts`, confirm at least one test fails, then copy the saved file
back. After the last probe, `diff` between the saved copy and `src/host/watchStep.ts` prints
nothing. Never run probes while another agent runs tests on this tree.

## Build steps

1. [x] **Pure step and its test.** Add `src/host/watchStep.ts` exactly as Data / contracts
   specifies, and `src/host/watchStep.test.ts`. Write the cases as `it.each` tables (rule 09:
   edge cases over volume), assert `state` and `effect` together with `toEqual`, and pass every
   input state through `Object.freeze` so a mutation throws. Do not assert anything about object
   identity: a "kept" row may return the input state object. Use `root = '/ws'`,
   `markerPath = '/ws/.vibeboard/.ensure-panel'`. Cover:
   - Row 1: `/ws/.vibeboard/.lock`, `/ws/.vibeboard/.lock.123` and
     `/ws/.vibeboard/pages/page-1/canvas.json.tmp` (nested), each with `write` and `delete`, from
     both `markerPending` values.
   - Rows 2-5: the marker `write` from `false` (row 4) and the marker `delete` from `true`
     (row 2); an artboard path `write` and `delete` from both values (rows 3, 5).
   - Nested marker name: `/ws/.vibeboard/pages/page-1/.ensure-panel` as a `write` from `false`
     (row 5: `false`, `debounce`) and as a `delete` from `true` (row 3: `true`, `debounce`).
   - Rows 6-12 from every `markerPending` value the row's condition allows: rows 6, 10, 11 and 12
     from both values; rows 7 and 8 from `true`; row 9 from `false`. Row 6 also with
     `trusted: false`, and row 9 with `trusted: false` (still `refresh`).
   Done when: `pnpm exec vp test run src/host/watchStep.test.ts` passes, `pnpm test` passes, and
   each probe below turns at least one test red:
   - a. Delete the `isLockOrTempPath` skip (lock and temp paths fall through to the other rows).
   - b. A marker `delete` returns `debounce` instead of `ignore`.
   - c. A marker `write` keeps `markerPending` as it was instead of setting it `true`.
   - d. A marker `delete` keeps `markerPending` as it was instead of setting it `false`.
   - e. `settled` ignores `sameFolder` (a pending run with `sameFolder: false` goes on).
   - f. `settled` ignores `trusted` (a pending, untrusted run returns `checkMarker`).
   - g. A settled run with `markerPending: false` returns `ignore` instead of `refresh`.
   - h. `markerChecked` with `exists: false` keeps `markerPending` as it was.
   - i. `opened` keeps `markerPending` as it was.
   - j. Replace `path === markerPath` with `basename(path) === basename(markerPath)` (from
     `node:path`), so a nested `.ensure-panel` counts as the marker.
2. [x] **Shell on the step, rule 05.** Rewire `watchArtboardDisk.ts` as Data / contracts: Shell
   describes, keeping its three exports and their argument types. Apply the two rule 05 edits from
   In scope.
   Done when:
   - `pnpm verify` passes.
   - `rg -n "pendingMarkerEnsure|isMarkerUri|isLockOrTempPath" src/host/watchArtboardDisk.ts`
     prints nothing.
   - `rg -n "vscode.workspace.isTrusted" src/host/watchArtboardDisk.ts` prints one line: the guard
     at the top of `replaceArtboardWatcher` (Shell, item 1).
   - `rg -n "firstWorkspaceFolder\(\)" src/host/watchArtboardDisk.ts` prints one line: the setup
     lookup in `replaceArtboardWatcher` (the run compares through `ports.workspaceRoot()`).
   - `rg -n "from 'vscode'" src/host/watchStep.ts` prints nothing.
   - The reviewer walks the Equivalence table against `git diff main -- src/host/watchArtboardDisk.ts`
     and confirms every old branch maps to exactly one row, with no row added.

## Files / areas

| File | Change |
|------|--------|
| `src/host/watchStep.ts` | new: pure `stepWatch`, `IDLE_WATCH_STATE`, `WatchEvent` |
| `src/host/watchStep.test.ts` | new: transition table tests |
| `src/host/watchArtboardDisk.ts` | shell rewired onto `stepWatch` |
| `.claude/rules/05-single-job.md` | Host no-`vscode` list and catalog |

## Data / contracts

### `watchStep.ts`

```ts
type WatchState = { readonly markerPending: boolean };

export type WatchEvent =
	// A watcher create or change event is `write`; a delete event is `delete`.
	| { type: 'disk'; change: 'write' | 'delete'; path: string; markerPath: string }
	// The 200 ms debounce fired and the serial run chain reached this run.
	| { type: 'settled'; sameFolder: boolean; trusted: boolean }
	// The shell's marker stat finished; a stat error counts as `exists: false` (the shell logs it first).
	| { type: 'markerChecked'; exists: boolean }
	// The shell opened the panel, refreshed and deleted the marker.
	| { type: 'opened' };

type WatchEffect = 'ignore' | 'debounce' | 'refresh' | 'checkMarker' | 'openPanel';

export const IDLE_WATCH_STATE: WatchState = { markerPending: false };
export const stepWatch = (state: WatchState, event: WatchEvent): { state: WatchState; effect: WatchEffect } => …;
```

Exports are exactly `IDLE_WATCH_STATE`, `stepWatch` and `WatchEvent` (the shell's apply helper
names it). `WatchState` and `WatchEffect` stay file-local: they may appear in the exported
signature (no declarations are emitted, and lint's `explicit-module-boundary-types` only needs the
annotation), and the shell infers them (`let watchState = IDLE_WATCH_STATE`, the helper's return).
Paths are compared as plain strings with `===`: the shell passes `uri.fsPath` and the marker's
`fsPath`, as today. `markerPath` rides on each disk event, so the state stays one boolean.

### Transition table

Rows are checked top to bottom; the first match wins. "kept" = the input `markerPending`.

| # | Event | Condition | Next `markerPending` | Effect |
|---|-------|-----------|----------------------|--------|
| 1 | `disk` | `isLockOrTempPath(path)` | kept | `ignore` |
| 2 | `disk` `delete` | `path === markerPath` | `false` | `ignore` |
| 3 | `disk` `delete` | other path | kept | `debounce` |
| 4 | `disk` `write` | `path === markerPath` | `true` | `debounce` |
| 5 | `disk` `write` | other path | kept | `debounce` |
| 6 | `settled` | `!sameFolder` | `false` | `ignore` |
| 7 | `settled` | `markerPending && !trusted` | `false` | `ignore` |
| 8 | `settled` | `markerPending` | `true` | `checkMarker` |
| 9 | `settled` | not `markerPending` | `false` | `refresh` |
| 10 | `markerChecked` | `!exists` | `false` | `ignore` |
| 11 | `markerChecked` | `exists` | kept | `openPanel` |
| 12 | `opened` | always | `false` | `ignore` |

Row 9 refreshes whatever `trusted` says: today's code reads trust only on the marker path, and
`refreshPanel` handles an untrusted workspace itself. Row 11 keeps the input value: a marker delete
during the stat leaves `false` and the panel still opens, as today.

### Shell (`watchArtboardDisk.ts`)

1. `replaceArtboardWatcher` keeps its first lines unchanged: `disposeArtboardWatcher()` (which
   already resets `watchState`; add no second reset), then return when
   `!vscode.workspace.isTrusted` or there is no first folder. It computes `markerUri` as today.
2. One local helper applies an event: `(event: WatchEvent)` calls `stepWatch(watchState, event)`,
   stores the returned state in `watchState`, and returns the effect. Every `watchState` change
   goes through it, except `disposeArtboardWatcher`, which resets `watchState` to
   `IDLE_WATCH_STATE` (today: `pendingMarkerEnsure = false`).
3. `onDidCreate` and `onDidChange` apply `{ type: 'disk', change: 'write', path: uri.fsPath,
   markerPath: markerUri.fsPath }`; `onDidDelete` applies the same with `change: 'delete'`. Effect
   `debounce` calls the existing `scheduleDebounce`; `ignore` does nothing.
4. The debounced run (still chained through `watchChain` with `then(run, run)`) applies
   `{ type: 'settled', sameFolder: ports.workspaceRoot() === workspaceFolder.uri.fsPath, trusted:
   ports.isTrusted() }`. `ports.workspaceRoot()` and `ports.isTrusted()` read the same values as
   today's `firstWorkspaceFolder()?.uri.fsPath` and `vscode.workspace.isTrusted`
   (`createPanelPorts`; the only ports the watcher gets). Trust is now read on every run, not only
   on a pending one; reading it has no side effect and only row 7 uses it.
   - `refresh`: `await refreshWatchedArtboard({ ports })` (unchanged: refreshes only when a panel
     exists).
   - `checkMarker`: `await fileExists(markerUri)`; on a throw, first
     `ports.log('watchArtboardDisk.markerStat', error)`, then treat it as `exists: false`. Apply
     `{ type: 'markerChecked', exists }`. On `openPanel`:
     `openArtboardPanel({ context, preserveFocus: true })`, `await refreshWatchedArtboard({ ports })`,
     `await deleteEnsurePanelMarker(markerUri, ports)`, then apply `{ type: 'opened' }`.
   - `ignore`: return.
5. Rearm (`rearmMarker: true`): when `fileExists(markerUri)` resolves `true`, apply
   `{ type: 'disk', change: 'write', path: markerUri.fsPath, markerPath: markerUri.fsPath }`
   (row 4: pending, `debounce`) and call `scheduleDebounce` on `debounce`. The `.catch` log stays.
6. `deleteEnsurePanelMarker`, `refreshWatchedArtboard`, `ensureArtboardWatcher`,
   `disposeArtboardWatcher`, `WATCH_DEBOUNCE_MS`, the log scopes and `watchChain` stay as they are.

### Equivalence (old code to rows)

| Old branch in `watchArtboardDisk.ts` | Row |
|-------------------------------------|-----|
| create/change: `isLockOrTempPath` return | 1 |
| create/change: marker sets `pendingMarkerEnsure = true`, then `scheduleDebounce` | 4 |
| create/change: other path, `scheduleDebounce` | 5 |
| delete: `isLockOrTempPath` return | 1 |
| delete: marker sets `pendingMarkerEnsure = false`, return | 2 |
| delete: other path, `scheduleDebounce` | 3 |
| run: folder gone or changed, pending `false`, return | 6 |
| run: pending and untrusted, pending `false`, return | 7 |
| run: pending, stat throws, pending `false`, log, return | 8, shell logs, then 10 |
| run: pending, marker missing, pending `false`, return | 8, then 10 |
| run: pending, marker there: open, refresh, delete marker, pending `false` | 8, 11, then 12 |
| run: not pending, refresh | 9 |
| rearm: marker exists, pending `true`, `scheduleDebounce` | 4 |
| dispose: pending `false` | shell reset to `IDLE_WATCH_STATE` |

## Testing

- `src/host/watchStep.test.ts` (Vitest, `pnpm test`): every transition row from the start states
  step 1 names, frozen inputs, probes a-j. No `vi.mock`, no `vscode`, no temp disk (the step does
  no I/O).
- The shell stays untested by unit tests, as today (rule 09: cover the extracted job, not the
  vscode wrapper). Its proof is the Equivalence walk and the `rg` checks in step 2, plus Verify.
- No browser test or gallery run: no chrome change.
- F5 (optional, Bombic; not claimed by this spec): in `fixtures/dev-workspace` with the panel
  closed, the Agent's `create_page` opens the panel without taking focus and the `.ensure-panel`
  file disappears; an Agent `update_artboard` refreshes the frame within about 200 ms.

## Notes for the AI

- Read `watchArtboardDisk.ts` before and after; it is 163 lines and every branch is in the
  Equivalence table. If you find a branch the table misses, stop and report it rather than
  inventing a row.
- Keep today's edge behavior even where it looks wrong; these are deliberate non-changes:
  - No `try`/`catch`/`finally` around the run's `refresh` branch or the open sequence. `opened` is
    applied only after the marker delete returns; a throw from `openArtboardPanel` or
    `refreshWatchedArtboard` leaves `markerPending` `true`, and `watchChain.then(run, run)` carries
    on with the next run, as today.
  - `opened` clears `markerPending` even if a new marker write arrived during the open run. The
    marker file is then deleted by the same run or stays until the next rearm; the panel is already
    open either way.
  - The module-level `watchState` (like `pendingMarkerEnsure` today) is shared across watcher
    replacements, so an old run that finishes after `replaceArtboardWatcher` can clear the new
    watcher's pending flag. A per-watcher instance would change that; it is out of scope.
  - The rearm stat runs outside `watchChain`, as today.
- `isLockOrTempPath` matches on the basename (`.lock`, `.lock.*`, `*.tmp`), so a nested temp file
  under `pages/<id>/` is skipped too; step 1 tests one nested path.
- Lint: explicit return types on exported functions, no short identifiers outside tests.
- Do not add a `ponytail:` comment: nothing here cuts a new corner.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":16646,"specSha256":"d5ef53f7329be60253a5084a543e18ddf6b4cbd48b216434cb294123945dbb48","branch":"refs/heads/feature/watcher-pure-step","head":"f75c88cada6c07ec8ed362274d05a8d28f450d7d","baseRef":"refs/heads/main","baseCommit":"f75c88cada6c07ec8ed362274d05a8d28f450d7d","sourceTree":"f81543ada79492d98dd807cd68570e005918b90e","landing":"local-merge","absentOptional":[]} -->
