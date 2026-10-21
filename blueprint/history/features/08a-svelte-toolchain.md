# Feature: Svelte toolchain

**From build-plan:** feature 8a
**Build attempt:** 1
**Branch:** feature/svelte-toolchain
**Status:** verified

## Goal

A Svelte 5 bundle builds into `dist/webview/`, loads in the artboard webview under the existing
CSP, and `svelte-check` plus the webview build run in `pnpm verify` (and so in CI). The 0.2
template-string chrome keeps rendering and behaving exactly as today. This de-risks the toolchain
before 8b ports the chrome.

Plan section: `blueprint/reference/0.3-comments-plan.md` → "8a. Svelte toolchain spike".

## In scope

- Dev deps `svelte`, `@sveltejs/vite-plugin-svelte`, `svelte-check`; TypeScript package pinned to TS 6.
- One Vite instance: vite-plugin-svelte's `vite` peer resolves to Vite+ core.
- `tsconfig.webview.json`, `vite.webview.config.ts`, `src/webview/main.ts`, `src/webview/App.svelte`
  (hidden hello root).
- Host shell loads `dist/webview/chrome.js` + `chrome.css` via `asWebviewUri`;
  `localResourceRoots` = `dist/webview` only.
- Scripts: `verify`, `compile`, `package`, `watch`; VS Code watch task; knip entries.
- Lint override for `src/webview/**`.
- Docs in the same change: AGENTS.md Commands, rules 07 and 08, `cursor-design-build` skill,
  `coding-standards.md` stack lines.

## Out of scope

- Porting any chrome behavior to Svelte (8b).
- Frame runtime as a bundled IIFE string (`virtual:frame-runtime`) and `stampArtboardHtml.ts`:
  moved to 8b, where `src/webview/frame/runtime.ts` first exists. Building the plugin now would
  ship an unused module. 8b's spec carries plan step 8a.5 and its `</` escaping gotcha.
- `happy-dom` (first needed by 8b's stamp test).
- Any change to CSP directives, message contract, MCP, disk, or `.cursor-design/`.

## Build loop

`workflow.stepReview: "feature"`, `checkpointCommits: "disabled"`: build all steps, run Verify
after each step that touches config or code, then one review packet at the end. `/complete`
makes the single feature commit on `feature/svelte-toolchain`.

## Build steps

- [x] **1. Dependencies, TS 6, one Vite.**
  - `pnpm add -D svelte@^5.57.2 @sveltejs/vite-plugin-svelte@^7.3.1 svelte-check@^4.7.7`.
  - `typescript`: `^7.0.2` → `~6.0.3` (svelte-check peer is `^5 || ^6`).
  - `pnpm-workspace.yaml` `overrides: { vite: "npm:@voidzero-dev/vite-plus-core@1.3.0" }` (the
    same alias `vite-plus` already depends on). Keep the existing `allowBuilds`.
  - Done when: `pnpm why vite` lists only `@voidzero-dev/vite-plus-core@1.3.0`;
    `pnpm verify` green on TS 6 (lint and type check still run on TS 7 via tsgolint);
    `pnpm compile-electron-tests` builds `out/test/**`.
- [x] **2. Webview TypeScript project + hello component.**
  - `tsconfig.webview.json`: `target/module` ES2022 + `moduleResolution: "bundler"`, `lib: ["ES2022",
    "DOM", "DOM.Iterable"]`, `types: []`, `strict`, `verbatimModuleSyntax`, `noEmit`,
    `include: ["src/webview/**/*.ts", "src/webview/**/*.svelte"]`, `exclude: ["src/webview/**/*.test.ts"]`.
    No `*.test.ts` exists under `src/webview` in 8a; 8b decides where webview tests type-check.
  - Root `tsconfig.json` excludes `src/webview` (host has no DOM lib).
  - `src/webview/main.ts`: `mount(App, { target })` on `#svelte-root`; if the element is missing,
    return without throwing.
  - `src/webview/App.svelte`: renders `<span data-svelte-chrome="ready"></span>` and one scoped
    `<style>` rule (so `chrome.css` is always emitted). Nothing visible.
  - Follow rule 08: Svelte MCP `list-sections` → `get-documentation` (`mount`, `$props`, TypeScript)
    before writing; `svelte-autofixer` on `App.svelte` until clean.
  - Lint: add a `src/webview/**` override in `vite.config.ts` banning `vscode` and Node built-ins
    (`node:*`, `fs`, `path`, `child_process`, `crypto`). Confirm `vp check` lints the
    `<script lang="ts">` block of `App.svelte` (introduce a temporary `var` locally, see it fail,
    remove it) and that oxfmt either formats `.svelte` correctly or is configured to skip it.
  - Done when: `pnpm exec svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings`
    reports 0 errors and 0 warnings; `vp check` clean; the lint override rejects
    `import * as vscode from 'vscode'` in a scratch `src/webview` file (removed after).
- [x] **3. Webview build.**
  - `vite.webview.config.ts` using `@sveltejs/vite-plugin-svelte` (`defineConfig` from
    `vite-plus`): input `src/webview/main.ts`, `outDir: dist/webview`, `emptyOutDir: true`, fixed
    names `chrome.js` / `chrome.css`, one chunk (no code splitting, CSS in one file),
    `modulePreload: false`, `base: './'`, sourcemap on except for `package`.
  - Command: `vp build -c vite.webview.config.ts` (`-c` is honored; options forward to Vite).
  - `vp pack` keeps `clean: false` so it never deletes `dist/webview`; the webview build only
    cleans `dist/webview`.
  - Done when: a clean build produces exactly `dist/webview/chrome.js`, `chrome.css` (+ maps);
    `vp pack` output in `dist/` is unchanged; running both in either order leaves all files.
- [x] **4. Host shell loads the bundle.**
  - `openArtboardPanel` uses `context.extensionUri`: `localResourceRoots:
    [Uri.joinPath(extensionUri, 'dist', 'webview')]`.
  - `buildArtboardChromeHtml({ webview, extensionUri })` (object args, rule 04) adds, after the
    existing inline script: `<div id="svelte-root" hidden></div>`,
    `<link rel="stylesheet" nonce="${nonce}" href="${chrome.css uri}">` in `<head>`, and
    `<script type="module" nonce="${nonce}" src="${chrome.js uri}"></script>`. URIs via
    `webview.asWebviewUri(Uri.joinPath(...))`. CSP string unchanged (`cspSource` already allowed
    for script and style).
  - The template-string chrome stays the only behavior. A failure to load or mount the bundle
    (missing file, runtime throw) cannot affect it: separate script element, separate root.
  - Update `artboardChromeHtml.test.ts`: the webview stub gains `asWebviewUri`; assert one CSP
    meta, one nonce on every `script`/`style`/`link`, exactly one inline script and one module
    script, the module `src` and stylesheet `href` come from `asWebviewUri` on
    `dist/webview/chrome.(js|css)`, no `http:`/`https:` resource, `#svelte-root` present and
    `hidden`. Keep every existing behavior test passing unchanged.
  - Done when: `vp test` green; F5 → open artboard → webview devtools show
    `[data-svelte-chrome="ready"]` inside `#svelte-root`, zero CSP violations, and the 0.2 chrome
    (toolbar, frames, zoom, pan) works as before.
- [x] **5. Scripts, tasks, knip, packaging.**
  - `verify`: `vp check && node scripts/check-agent-rules.mjs && svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings && vp test && vp pack && vp build -c vite.webview.config.ts`.
  - `compile`: `vp check --no-fmt && vp pack && vp build -c vite.webview.config.ts`.
  - `package`: `vp check --no-fmt && vp pack --minify --no-sourcemap && vp build -c vite.webview.config.ts --sourcemap false`.
  - `watch:webview`: `vp build -c vite.webview.config.ts --watch`; `watch`:
    `pnpm run --parallel "/^watch:/"`. `.vscode/tasks.json` `watch` depends on both
    `npm: watch:pack` and `npm: watch:webview` (background matcher on Vite's watch output).
  - `knip.json`: entries `vite.webview.config.ts`, `src/webview/main.ts`; project includes
    `src/webview/**/*.{ts,svelte}`.
  - `.vscodeignore`: unchanged unless `dist/webview/**` is excluded (it is not today; `**/*.map`
    stays excluded). Confirm with `pnpm vsix` that the package lists `dist/webview/chrome.js`
    and `chrome.css`.
  - Done when: `pnpm verify` green; `pnpm knip` clean; F5 preLaunch `compile` builds both;
    `.vsix` file list includes both webview files.
- [x] **6. Docs and rules in the same change.**
  - AGENTS.md Commands: Verify, Compile, Package, Watch lines; one line on TS 6 vs TS 7.
  - Rule 08: TS pin with exit condition (`ponytail:` TS 6 only until `svelte-check` supports
    TS 7, then `^7`), the webview build and `svelte-check` commands.
  - Rule 07: "`localResourceRoots` = extension resources only (`dist/webview`), never the workspace".
  - `cursor-design-build` skill: third bundle (webview) and its command.
  - `coding-standards.md` Stack: chrome build, TS 6 package / TS 7 lint split.
  - Done when: `node scripts/check-agent-rules.mjs` passes and docs match the scripts verbatim.

## Files / areas

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `tsconfig.json`, new `tsconfig.webview.json`
- `vite.config.ts` (lint override only), new `vite.webview.config.ts`
- new `src/webview/main.ts`, `src/webview/App.svelte`
- `src/panel/artboardChromeHtml.ts`, `src/panel/artboardChromeHtml.test.ts`,
  `src/panel/openArtboardPanel.ts`
- `.vscode/tasks.json`, `knip.json`, `.vscodeignore` (check only)
- `AGENTS.md`, `.claude/rules/07-vscode-extension.md`, `.claude/rules/08-svelte-chrome.md`,
  `.cursor/skills/cursor-design-build/SKILL.md`, `blueprint/context/coding-standards.md`

## Data / contracts

- No disk, MCP, or message contract change.
- Webview document gains `#svelte-root[hidden]`, one `<link rel="stylesheet">` and one
  `<script type="module">`, both nonce'd, both from `asWebviewUri` under `dist/webview/`.
- CSP unchanged: `default-src 'none'; style-src 'nonce-…' cspSource; script-src 'nonce-…' cspSource; frame-src blob:`.
- Build outputs (fixed names, relied on by the shell): `dist/webview/chrome.js`, `dist/webview/chrome.css`.

## Testing

- Unit (`vp test`): updated `artboardChromeHtml.test.ts` shell assertions (step 4). Edge cases:
  every `script`/`style`/`link` carries the same nonce; no inline script gains `type="module"`;
  no `http(s):` URL anywhere; the module script is after the inline script (inline chrome
  initializes first).
- `svelte-check --fail-on-warnings` is the Svelte type gate.
- Verify (`pnpm verify`) and CI run all of the above plus the webview build.
- F5 (manual, recorded in `/check`): hello root present, zero CSP violations, 0.2 parity spot
  check (toolbar, zoom at cursor, pan, frame edit reloads only its iframe, MCP banner).
- Failure path (F5): delete `dist/webview/chrome.js`, reload the panel: 0.2 chrome still fully
  works; the only symptom is the missing hello root (devtools 404 for the module).
- No test for the Vite config itself; the build step and Verify prove it.

## Notes for the AI

- Rule 08 Svelte workflow applies to `App.svelte` and `main.ts`: docs before, `svelte-autofixer`
  after every edit until clean. In Claude Code prefer the `svelte-file-editor` agent.
- Lint and type checks keep running on TS 7 (`oxlint-tsgolint` ignores the `typescript`
  package). Do not remove `typeAware` / `typeCheck`.
- If `svelte-check` fails on TS 6, fall back to `svelte-check-native` and record it here and in
  rule 08; do not downgrade lint.
- Do not add `'unsafe-inline'` or `'unsafe-eval'` to the CSP. Svelte 5 compiled output needs
  neither; if a violation appears, fix the build (for example CSS injection off), not the CSP.
- `openArtboardPanel` currently destructures only `preserveFocus`; take `context` from its args.
- Verify at spec time (2026-10-21, `main` at `fa25156`): `pnpm verify` green, 204 tests.



<!-- blueprint:completion {"schemaVersion":2,"specBytes":11158,"specSha256":"36e641c616da798a377c82a1076a5772f34ec3eccf8efc8a49addcecb76aed63","branch":"refs/heads/feature/svelte-toolchain","head":"fa25156cb2a21e2f8242073076d1e1229a3e60ec","baseRef":"refs/heads/main","baseCommit":"fa25156cb2a21e2f8242073076d1e1229a3e60ec","sourceTree":"bee271ff0d0163044adbba547db7691194a9e2a8","landing":"local-merge","absentOptional":[]} -->

## Try it now

Run or do:

`pnpm exec vp build -c vite.webview.config.ts`

Expected:

`dist/webview/chrome.js` and `dist/webview/chrome.css` exist (plus `chrome.js.map` when sourcemaps are on).

This proves:

The Svelte 5 webview bundle builds to the fixed names the host shell loads.
