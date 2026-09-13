# Phase 4 Release polish - Overview for review

Source of truth: `blueprint/history/features/05-phase-4-release-polish.md`. This file is the steering summary, not the build spec.

## TL;DR

`cursor-design` is installable as v0.1.0: `pnpm vsix` writes `cursor-design-0.1.0.vsix`, the README has Install plus an honest Limits (v1) list plus one screenshot, MIT is declared consistently. Zero behavior change; `src/` is untouched.

## Flow

```
1. package.json: version 0.1.0 + repository/bugs/homepage/keywords + `vsix` script
2. @types/vscode pinned DOWN to ~1.125.0 (engines stays ^1.128.0)
3. .vscodeignore reviewed: package holds only runtime + docs + one PNG
4. pnpm vsix builds; contents verified with unzip -l against the allowlist
5. README Status/Install/Limits + CHANGELOG 0.1.0 entry
6. Smoke-installed in Cursor 3.20.17 on 2026-09-13; dated line in Install
```

## System map

```mermaid
flowchart LR
  Repo["Repo"] --> Vsix["pnpm vsix"]
  Vsix --> Pre["vscode:prepublish -> pnpm package -> esbuild"]
  Pre --> Artifact["cursor-design-0.1.0.vsix"]
  Artifact --> Install["Extensions: Install from VSIX"]
  Install --> Live["Panel + MCP live in Cursor"]
```

## What you will see

- `cursor-design-0.1.0.vsix` at the repo root (gitignored), installed via **Extensions: Install from VSIX**.
- README: v0.1.0 Status one-liner, Install steps, one artboard screenshot, Limits (v1) list.
- The `.vsix` contains only `package.json`, `dist/extension.js`, `dist/mcp.js`, `readme.md`, `changelog.md`, `LICENSE.txt`, `media/artboard-panel.png`.

## Architecture decisions

- vsce runs via `pnpm dlx @vscode/vsce@3.9.2`, so no new devDependency. `--no-dependencies` is required: both entries are esbuild-bundled and vsce's dependency walk breaks on the pnpm `node_modules` layout.
- Types pinned down to `~1.125.0` (`1.128.0` is unpublished; vsce requires types <= engines). `engines` stays `^1.128.0` for Cursor installability.
- One screenshot only; the second-screenshot plan was dropped from the plans.
- Limits are documented as-is, including recorded drift (process-wide MCP queue, single-file handoff, vanilla chrome). Nothing was fixed here.

## Decisions locked

- Ship path is the `.vsix` file: no Marketplace publish, no GitHub Releases sentence yet (hosting still open).
- `engines.vscode` stays `^1.128.0`.
- No icon, no Blueprint Verify command, no `src/` changes.

## Out of scope

- Marketplace / Open VSX publish and GitHub Release upload.
- Extension icon, second screenshot, gallery banner.
- Behavior fixes for the documented limits; Svelte migration; new MCP tools.

## Glossary

Term | Why it exists
--- | ---
`.vsix` | Installable extension package that Cursor sideloads
vsce | Packaging tool that builds the `.vsix`
`engines.vscode` | Minimum host version the extension declares
`@types/vscode` | Type definitions; vsce requires them to be <= engines
`.vscodeignore` | Decides what stays out of the packaged extension
Handoff | Exported artboard plus `IMPLEMENT.md` for a builder Agent (Phase 3, unchanged here)

## Your actions

1. `pnpm vsix`, then **Extensions: Install from VSIX**, then reload.
2. Open a trusted folder; run **Cursor Design: Open Artboard**.
3. Settings, MCP: allowlist `cursor-design` (toggle off/on if the tool count stays 0).

## Done means

- `pnpm check-types && pnpm lint && pnpm package` green; `pnpm vsix` writes the artifact with no prompt.
- `unzip -l` shows only allowlisted `extension/` paths; the artifact is gitignored.
- The panel opens from the installed `.vsix`; MCP lists `cursor-design`; no CSP or activate errors.
