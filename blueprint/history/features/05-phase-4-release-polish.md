# Feature: Phase 4 Release polish

**From build-plan:** feature 5
**Build attempt:** 1
**Branch:** `feature/phase-4-release-polish`
**Status:** verified

## Goal

Make `cursor-design` installable and honest as a v0.1.0 open-source release: a real `.vsix` comes out of one command, the MIT license is declared consistently, the README gains an Install section and states the v1 limits plainly. No new product behavior; the extension code does not change except for manifest metadata. Overview: "Phase 4 Release polish - MIT, honest limits". Ship path is a `.vsix` (Deployment: `pnpm package -> .vsix`), not Marketplace publishing and not Vercel/Render.

## In scope

- **`.vsix` build actually exists.** Today `pnpm package` only runs typecheck + lint + esbuild production; no `@vscode/vsce` is installed and no `.vsix` is produced, so the overview's `pnpm package -> .vsix` is currently false. Add one script that pins vsce at implement time: run `pnpm view @vscode/vsce version` and bake that exact version into `"vsix": "pnpm dlx @vscode/vsce@<exact> package --no-dependencies"` (no new devDependency; `pnpm dlx` fetches that version on demand). Do not insert `--` between the package name and `package`: vsce then treats `--no-dependencies` as `[version]` and fails (`Invalid version --no-dependencies`). pnpm 11 passes the flag through after `package`. `--no-dependencies` is required: both entries are esbuild-bundled (`dist/extension.js`, `dist/mcp.js`), and vsce's dependency walk does not work with pnpm's `node_modules` layout. vsce triggers the existing `vscode:prepublish` → `pnpm run package`, so the production build runs first. `*.vsix` is already gitignored.
- **`package.json` metadata vsce needs / release needs:**
  - `repository`: `{ "type": "git", "url": "https://github.com/marekbombera/cursor-design-extension.git" }` (the `origin` remote; without it vsce prompts and README relative links cannot be rewritten)
  - `homepage`: `https://github.com/marekbombera/cursor-design-extension`
  - `bugs`: `{ "url": "https://github.com/marekbombera/cursor-design-extension/issues" }`
  - `keywords`: `cursor`, `mcp`, `design`, `artboard`, `webview`
  - `version` `0.0.1` → `0.1.0`
  - `license: "MIT"` is already set; keep
  - `publisher`, `displayName`, `name`, `categories`, `main`, `engines`, `activationEvents`, `extensionKind`, `capabilities.untrustedWorkspaces` stay as they are except the types pin below
  - Confirm `vscode:prepublish` remains `pnpm run package`. No `icon` (not in the plan; see Out of scope).
- **`engines.vscode` vs `@types/vscode` alignment.** `engines.vscode` is `^1.128.0` while `@types/vscode` is `^1.136.0`; vsce refuses to package when the types version is greater than the engine. `@types/vscode@1.128.0` is unpublished (nearest published: `1.125.0` then `1.134.0`). **Open question 1 resolved:** pin `@types/vscode` to `~1.125.0` only (`pnpm add -D @types/vscode@~1.125.0`). Never write `^` for the types range. Keep `engines` at `^1.128.0` (Phase 0 Cursor installability). Confirm `pnpm check-types` still passes (the host only uses stable API + the local `src/types/vscode.cursor.d.ts` shim). If typecheck fails on that pin, **stop Step 1**; do not bump `engines` and do not continue to later steps.
- **`.vscodeignore` review.** Keep excluding `src/**`, `fixtures/**`, `blueprint/**`, `.cursor/**`, `.agents/**`, `.claude/**`, `.vscode/**`, `out/**`, `node_modules/**`, `**/*.map`, `esbuild.js`, tsconfig, lint/fmt configs. Remove the stale `AGENTS copy.md` entry (no such file). Add `AGENTS.md`, `CLAUDE.md`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/**`. Do not exclude `media/**`. The package holds only `package.json`, `dist/extension.js`, `dist/mcp.js`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `media/artboard-panel.png`.
- **One README screenshot.** Copy Bombic's provided hero+CTA artboard capture to `media/artboard-panel.png` only. README embeds `![Artboard panel](media/artboard-panel.png)`. Drop `media/handoff-stale-badge.png` and every second-screenshot reference. Do not generate a placeholder. Crop/size only if needed to keep the PNG under ~500KB.
- **MIT consistency.** `LICENSE` (MIT, 2026 Marek Bombera) and `package.json` `license` already agree. README keeps its License section. Verify `LICENSE` is inside the `.vsix` (vsce includes it by default; it must not be in `.vscodeignore`).
- **README "Limits (v1)" section** - one honest list, stated as facts, not roadmap. Do not "correct" documented drift toward the rules. Every line is either a code/rule constraint or a labeled distribution/product fact:

  Code / `package.json` constraints (spot-check with `rg` in Step 3):
  - Cursor only: MCP registration uses `vscode.cursor.mcp.registerServer`; in plain VS Code the server is not registered (warning in Output → Cursor Design), the panel still renders `.cursor-design/` from disk, no Agent loop.
  - First workspace folder only; multi-root beyond the first folder is ignored (`revealDesignFolder.ts`, `handleOpenArtboard.ts` ponytail).
  - Untrusted workspaces unsupported (`capabilities.untrustedWorkspaces.supported: false`); artboard HTML is executable workspace content.
  - One active artboard, no gallery; variants are new ids + `set_active_artboard`.
  - Writes: one process-wide MCP queue (recorded drift vs rule 02 "Serialize writes per artboard id"; document as-is, do not change the queue); host-vs-MCP manifest writes are last-writer-wins; no cross-window lock (`mcpQueue.ts`, `watchArtboardDisk.ts`, `artboardFs.ts` ponytails). Failed multi-file writes leave partial files (no journal/rollback); orphan handoff dirs are never deleted.
  - Artboard iframe: `sandbox="allow-scripts"`, CSP blocks inline event handlers, `style=""` attributes and external subresources in the artboard (`artboardChromeHtml.ts` v1 limit).
  - Handoff carries the whole document in `index.html` (no CSS/JS split; recorded Phase 3 lock vs overview "HTML+CSS+JS"); `.cursor-design/assets/` is copied manually; `tokens.json` is passed through without validation.
  - Brain is Cursor Agent only: no in-panel chat, no model API keys, no `vscode.lm`.

  Distribution / product facts (no `src/` / `package.json` `rg` required):
  - Not on the Marketplace; install from `.vsix` (**Extensions: Install from VSIX…**).
  - Cursor MCP settings may show **0 tools** until the server is toggled off/on (already documented; move under Limits).
  - Chrome is vanilla nonce'd script, not the Svelte 5 + Vite chrome named in the overview (recorded drift, not fixed here).

- **README restructure (surgical):** update **Status** from "Phase 3: …" to a v0.1.0 one-liner that does not contain `Phase 3`; add **Install** (exact body below) above **Develop**; add the one screenshot embed `![Artboard panel](media/artboard-panel.png)` after Status (or with Install); add **Limits (v1)** before **License**. Keep the MCP tools table, Develop, and "Export to implement trial" sections as they are (byte-for-byte except the moved 0-tools sentence). No em dashes in README or CHANGELOG (hyphens / colons only).

  **Install** section body (exact; do not mention GitHub Releases - that is Open question 2):

  ```markdown
  ## Install

  1. From this repo: `pnpm vsix` writes `cursor-design-0.1.0.vsix` at the repo root.
  2. In Cursor: Command Palette → **Extensions: Install from VSIX…** → pick that file → reload.
  3. Open a trusted folder. Command Palette → **Cursor Design: Open Artboard**.
  4. Settings → MCP: allowlist `cursor-design` (toggle off/on if the tool count stays 0; see Limits).
  ```

  After Step 4 succeeds, append one observed line under Install: `Smoke-tested <YYYY-MM-DD>, Cursor <version>`.

- **CHANGELOG.md:** replace the template body with a `## [0.1.0] - YYYY-MM-DD` entry (Keep a Changelog; date = implement day) listing: artboard panel, seven MCP tools, generation/hash conflict, MCP-unavailable banner, export handoff + stale badge, `.vsix` build. Keep `## [Unreleased]` empty above it.
- **`AGENTS.md` Commands:** add `- Package .vsix: \`pnpm vsix\`` next to the existing Package line and correct the Package line to say it builds `dist/` only.

## Out of scope

- Publishing to the VS Code Marketplace or Open VSX (`vsce publish`, publisher PAT, account). A GitHub Release upload is Bombic's optional manual step after `/complete`; not automated here and not in README Install until Open question 2 is answered.
- Extension `icon` / branding artwork, gallery banner, hero GIF, and a second screenshot (`media/handoff-stale-badge.png`). One artboard PNG is in scope.
- Adding a Blueprint Verify command, `/ci`, GitHub Actions, or changing `pnpm test` / `.vscode-test.mjs` (Phase 2/3 precedent).
- Any behavior change in host, MCP, or chrome; Svelte migration; new MCP tools; multi-root; per-id queue; asset copying. Limits are documented, not fixed.
- Bumping `engines.vscode` upward (see Open questions).
- Editing `blueprint/context/project-overview.md` (Deployment still says `pnpm package -> .vsix`; leave that for `/overview`).
- Notion spec edits, Grok Build messaging, paid kits.

## Build loop

`workflow.stepReview: feature` → implement all steps, then one review packet. `checkpointCommits: disabled` → no step commits; `/complete` creates the feature commit. Per step: `pnpm check-types && pnpm lint`. Step 1 needs network for `pnpm add` and `pnpm view @vscode/vsce version`. Step 2 needs network for `pnpm dlx`. Do not claim Marketplace, Cursor-install, or pixel evidence that was not observed.

## Build steps

- [x] **Step 1 - Manifest + ignore + types alignment** - `package.json`: `version` 0.1.0, `repository` / `bugs` / `homepage` URLs from In scope, `keywords`, `"vsix"` script with exact vsce version from `pnpm view` and `package --no-dependencies` (no `--` before `package`); `pnpm add -D @types/vscode@~1.125.0`. Confirm `vscode:prepublish` is still `pnpm run package`. `.vscodeignore`: remove `AGENTS copy.md`, add `AGENTS.md`, `CLAUDE.md`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/**`; do not exclude `media/**`. `AGENTS.md` Commands updated. *Done when:* `pnpm check-types && pnpm lint && pnpm package` pass with types `~1.125.0` (never `^`) and `dist/extension.js` + `dist/mcp.js` are rebuilt; `git diff package.json` shows no change to `engines`, `activationEvents`, `extensionKind`, `capabilities`, `contributes`, `vscode:prepublish`; `.vscodeignore` contains the new excludes and does not contain `AGENTS copy.md`; `AGENTS.md` Commands lists both Package (`dist/` only) and Package `.vsix` (`pnpm vsix`); existing `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js` still pass (`compile-tests` is a `package.json` script, not an AGENTS.md Commands / Blueprint gate). If `pnpm check-types` fails, stop here; do not start Step 2.

- [x] **Step 2 - `.vsix` builds and contains only the runtime** - Copy the provided capture to `media/artboard-panel.png` (real PNG, under ~500KB) if it is not already there. Run `pnpm vsix`. *Done when:* `cursor-design-0.1.0.vsix` is written at repo root with no vsce error or prompt (no missing-repository question, no engines/types mismatch); `unzip -l cursor-design-0.1.0.vsix` shows every path under `extension/` is one of `package.json`, `dist/extension.js`, `dist/mcp.js`, `readme.md`, `changelog.md`, `LICENSE.txt`, `media/artboard-panel.png` (vsce lowercases README/CHANGELOG and writes `LICENSE.txt`) and **fails if any other `extension/` path is present** (including `media/handoff-stale-badge.png`); `git check-ignore -q cursor-design-0.1.0.vsix` exits 0. Zip-root vsce files (`[Content_Types].xml`, `extension.vsixmanifest`) are expected and not part of the `extension/` allowlist.

- [x] **Step 3 - README + CHANGELOG** - README: Status one-liner (must contain `v0.1.0` and must not contain `Phase 3`), Install section (exact body from In scope, no GitHub Releases), one screenshot embed `![Artboard panel](media/artboard-panel.png)` and no second-screenshot path, Limits (v1) list (every bullet above, drift labeled). CHANGELOG: `[0.1.0] - YYYY-MM-DD`. *Done when:* each code/`package.json` Limits bullet `rg`-matches its cited ponytail, CSP, `registerServer`, or `untrustedWorkspaces` line; distribution/product bullets are present as written and are not `rg`'d against `src/`; Status line check is Status-only (not a file-wide `rg 'Phase 3'`); README has exactly one `media/` image (`artboard-panel.png`); `pnpm vsix` re-run succeeds and `unzip -l` `extension/` paths still match the Step 2 allowlist.

- [x] **Step 4 - Install-from-VSIX smoke (manual, Cursor)** - Use the `.vsix` from the Step 3 rebuild. Bombic installs it into the regular Cursor window (**Extensions: Install from VSIX…**), reloads, opens a **trusted** folder. Allowlist MCP `cursor-design`. *Done when:* **Cursor Design: Open Artboard** appears in the Command Palette and opens the panel; Settings → MCP lists `cursor-design`; Output → Cursor Design shows no error on activate; no webview CSP error. Result is recorded as one dated line in README **Install** (`Smoke-tested YYYY-MM-DD, Cursor <version>`). If Cursor's VS Code base reports a version below `1.128`, stop and raise Open question 1 (this case does not rewrite a passing Step 1).

## Files / areas

- `package.json` - version, repository/bugs/homepage/keywords, `vsix` script, `@types/vscode` pin
- `pnpm-lock.yaml` - types pin
- `.vscodeignore` - stale entry removed, workflow files excluded
- `README.md` - Status, Install, one screenshot embed, Limits (v1)
- `CHANGELOG.md` - 0.1.0 entry
- `AGENTS.md` - Commands section (Package / Package .vsix lines)
- `media/artboard-panel.png` - one README screenshot (no second PNG)
- No changes under `src/`, `fixtures/`, `blueprint/context/*` other than this spec's lifecycle files. Do not edit `project-overview.md` in this feature.

## Data / contracts

- No disk SoT, MCP, or webview message changes. Manifest schema version stays `1`; tool names unchanged.
- Package identity: `publisher` `cursor-design`, `name` `cursor-design`, version `0.1.0` → artifact `cursor-design-0.1.0.vsix`. Extension id `cursor-design.cursor-design`.
- `engines.vscode` stays `^1.128.0`; `@types/vscode` is `~1.125.0` (tilde only; Open question 1 resolved) so vsce's types ≤ engines check passes. Rule 07 mentions `^1.136` for contributed-command activation; this feature does not bump engines. `activationEvents: ["onStartupFinished"]` is left unchanged.
- Package contents contract: every path under `extension/` in the `.vsix` must be one of `dist/extension.js`, `dist/mcp.js`, `package.json`, `readme.md`, `changelog.md`, `LICENSE.txt`, `media/artboard-panel.png` (vsce renames README/CHANGELOG/LICENSE). `dist/mcp.js` must contain no `require("vscode")` (Phase 2 check, re-run in Step 1 after the production rebuild).

## Testing

- No Verify command declared; no Blueprint test gate. Gates per step: `pnpm check-types && pnpm lint`, `pnpm package`, `pnpm vsix`, `unzip -l` against the `extension/` allowlist, `git check-ignore`. Existing `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js` must still pass after the `@types/vscode` pin (run once in Step 1). That script is not listed in AGENTS.md Commands and is not turned into a Blueprint gate.
- Manual evidence (Bombic): Install-from-VSIX smoke (Step 4). Record only what was observed, with date and Cursor version.
- No unit tests added: the feature is metadata and docs; there is no logic to assert (ponytail).

## Notes for the AI

- `pnpm add`, `pnpm view`, and `pnpm dlx @vscode/vsce@<exact>` need network; if the sandbox blocks them, request `full_network` rather than adding vsce as a devDependency.
- Do not touch `src/**`. Documented limits are copied from existing `ponytail:` comments and rule text; do not "fix" them while writing them down, including recorded drift (process-wide queue, handoff as one `index.html`, vanilla chrome).
- Do not add AI attribution to the changelog or commit.
- Keep README edits surgical; the "Export to implement trial" section and the tool list stay byte-for-byte except the moved 0-tools sentence.
- No em dashes (U+2014) in README, CHANGELOG, or comments.

## Open questions

1. **Resolved (types pin).** `@types/vscode@1.128.0` is unpublished. Pin is `~1.125.0`; engines stay `^1.128.0`. If Step 1 `pnpm check-types` fails on that pin, **Step 1 is blocked** (do not bump engines). The "Cursor base below 1.128" case is Step 4 only and does not waive a failed Step 1.
2. **Where the `.vsix` is hosted.** README **Install** does not mention GitHub Releases. Confirm before `/complete` if a Releases download sentence is wanted; text-only change.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":16661,"specSha256":"d0623e9d1c68490f6cecde2316bf0806aa54843ac9ad6150eb3bee27505a7162","branch":"refs/heads/feature/phase-4-release-polish","head":"d386cf383a4b91f44acff09a1e7389a42ec5ce54","baseRef":"refs/heads/main","baseCommit":"d386cf383a4b91f44acff09a1e7389a42ec5ce54","sourceTree":"ef0d3c7c25520aab86ced1a0607b362ec2ea0f37","absentOptional":[]} -->
