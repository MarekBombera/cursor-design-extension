# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.


### F-01 [P3] fixed - Self-rooted artboardDisk tests shadow the module root

**File:** src/host/artboardDisk.test.ts:242
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Three tests declare `const root` over the module `let root`; inside them `args`, `manifestPath()` and `writeManifest()` still target the beforeEach root. Harmless today, a silent wrong-folder trap for 11c2.
**Suggested fix:** Rename the locals (`ownRoot`).
**Resolution:** Locals renamed to `ownRoot` in the three self-rooted tests. (fixed 2026-11-27, awaiting re-review)

### F-02 [P3] fixed - createPanelPorts test leaves shared mock state changed

**File:** src/panel/openArtboardPanel.test.ts:88
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** It flips `panelMock.isTrusted`/`root` and grows `warnings` with no reset; a later test would inherit an untrusted, folderless vscode.
**Suggested fix:** Reset the mock state in a `beforeEach`.
**Resolution:** `beforeEach` resets isTrusted, root, warnings, choice and the new clipboardError. (fixed 2026-11-27, awaiting re-review)

### F-03 [P3] fixed - Spec names the wrong row for the step-2 mutation probe

**File:** blueprint/context/current-feature.md:118
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** beforeEach already writes the manifest, so dropping the per-row write fails on the `failed` row, not `frames` (confirmed by a real probe in /implement).
**Suggested fix:** Correct the row name.
**Resolution:** Spec step 2 done-when now names the `failed` row and why. (fixed 2026-11-27, awaiting re-review)

### F-04 [P3] fixed - Spec drift: verbatimModuleSyntax and WorkspaceDiskArgs

**File:** blueprint/context/current-feature.md:228
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** `verbatimModuleSyntax` is set only in tsconfig.webview.json, not the host tsconfig; step 3 says `WorkspaceDiskArgs` goes, the code keeps it reshaped (used 3x, rule 04 allows it).
**Suggested fix:** Reword both lines to match the code.
**Resolution:** Spec reworded: `WorkspaceDiskArgs` becomes `{ workspaceRoot, ports }`; the `import type` note says `verbatimModuleSyntax` is webview-only today. (fixed 2026-11-27, awaiting re-review)

### F-05 [P3] fixed - No test covers the awaited clipboard write in createPanelPorts

**File:** src/panel/openArtboardPanel.ts:90
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Dropping the `await` in `writeClipboard` would let a rejected clipboard write still reach `markCommentsSent` (rule 02), and no automated test would fail.
**Suggested fix:** Assert in the createPanelPorts test that a rejecting `env.clipboard.writeText` rejects `writeClipboard`.
**Resolution:** New test `createPanelPorts: a rejected clipboard write rejects writeClipboard`; probe replacing the `await` with a swallowed write fails it. (fixed 2026-11-27, awaiting re-review)
