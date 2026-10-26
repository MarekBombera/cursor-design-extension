# Coding Standards

> **Code rules live in `.claude/rules/`** (`.cursor/rules/*.mdc` link to them). Claude Code and Cursor load them automatically: `00-cursor-design-core` and `03-ponytail` always, the rest when you touch matching files (`02` MCP/webview, `04` conventions, `05` module ownership and owner catalog, `06` errors, `07` VS Code host, `08` Svelte chrome, `09` tests). Lint in `vite.config.ts` enforces the mechanical conventions. Skills: `cursor-design-build` (repo); the shipped Agent skill `cursor-design` lives in `skills/cursor-design/SKILL.md` and is synced to `~/.cursor/skills/` on activate.
>
> This file holds the stack, testing, and writing standards Blueprint skills read, so `/implement` does not load React/Next defaults. Do not duplicate the rules here.

This is a **Cursor/VS Code extension** (WebviewPanel + local MCP). Not Next.js, React, SvelteKit, TanStack Start, or a Chrome extension.

## Stack (locked)

- **Package manager:** `pnpm`
- **Host:** TypeScript + `vp pack` / tsdown (`dist/extension.js`, `deps.neverBundle: ['vscode']`)
- **MCP process:** TypeScript + `vp pack` / tsdown (`dist/mcp.js`, runtime deps in `deps.alwaysBundle`); package `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`
- **Chrome:** Svelte 5 + Vite, no SvelteKit (`vp build -c vite.webview.config.ts` → `dist/webview/chrome.js` + `chrome.css`). Artboard: nested sandboxed HTML iframe
- **TypeScript:** package `typescript` is `~6.0.3` for `svelte-check`; lint / type-aware check still run on TS 7 via tsgolint
- **Validation:** `zod` v4 (same range as the MCP SDK) via `import * as z from 'zod/mini'` for disk JSON files in `src/disk/parse.ts` (the namespace import keeps tree-shaking; `import { z }` or classic `zod` bundles every locale). MCP tool inputs stay passthrough `fromJsonSchema` + authored errors; chrome stays dependency-free.
- **Lint / format / type check:** Vite+ `vp check` (Oxlint + Oxfmt + tsgolint type check); config in `vite.config.ts`, which also enforces the mechanical code conventions. Unused files/deps: `pnpm knip` (separate from `vp check`)
- **Verify UI:** chrome and iframe behavior with `pnpm test:browser` (Playwright Chromium over the built bundle, `tests/browser/`); **F5** Extension Development Host (`fixtures/dev-workspace`) for Cursor-only checks. There is no `npm run dev` / `localhost:3000` app server
- **MCP register:** `vscode.cursor.mcp.registerServer` (stdio) only

## Chrome vs artboard

- Chrome: `var(--vscode-*)` theme tokens, keyboard order, ARIA. Not React, not Tailwind-by-default, not shadcn.
- Artboard HTML is user/Agent content. Do not theme it as chrome. Never `eval` it in the parent. Iframe `sandbox="allow-scripts"`.

## Testing

The Blueprint test gate is on via `vp test` (declared as `Test` in `AGENTS.md` Commands). Logic-bearing steps use that command. `package.json`'s `vscode-test` script (`pnpm test`) does not count as this gate. `/ci` still owns a `Verify` command. The Electron sample is compiled with `pnpm compile-electron-tests` and run with `pnpm test`; it is not this gate and stays out of Verify. A coverage script (`pnpm coverage`) exists for a local report; it has no thresholds and is not part of Verify.

Do not run `/tests` to add or replace the runner; Vitest via `vp test` is it. Test-writing details: `.claude/rules/09-tests.md`.

- **What to test:** pure logic where a wrong answer is possible (parsers, disk schema, generation/hash, conflict handling). Assert inputs/outputs and edge cases (empty, missing, malformed).
- **What not to test:** Svelte chrome and the artboard iframe as unit tests. The browser tests prove those (`.claude/rules/09-tests.md`); F5 covers Cursor-only checks.
- When a runner is configured: a step that adds in-scope logic ships a passing test in the same diff. Empty suite should fail, not pass.
- Test files live next to source (`feature.test.ts`). `*.test.ts` covers the extracted util, not the VS Code `activate` wrapper.
- Stack binding: TypeScript extension. If/when a test command is declared, mock disk/MCP boundaries, not a web-app ORM or React tree.

## Browser Verification

There is no web app on `localhost:3000`. Chrome and iframe behavior is proven by `Browser tests` (`AGENTS.md`): `pnpm test:browser` drives the built chrome bundle in `tests/browser/harness.ts` with a stubbed VS Code host and real sandboxed blob frames.

- Browser tests assert behavior through roles, `data-cd-*` hooks, captured messages and boxes, never pixels or timing sleeps beyond the one stability quiet window. Reuse the one harness.
- **F5** in Cursor stays for Cursor-only checks: webview CSP, MCP registration, Extension Host, webview hide/show, Cursor focus.
- Browser tests are not part of default Verify/CI unless chosen separately.

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- File size follows `05-single-job`: split mixed concerns; do not split a one-job module to hit a line count

## Comments

Write code that explains itself; comment only what the code cannot say.

- Comment the **why**, not the **what**. Delete any comment that restates the code.
- No banner/header blocks or step-by-step narration of obvious code.
- A comment earns its place for a non-obvious decision, a gotcha, why a value is what it is, or a link to the spec. Use `ponytail:` when cutting a known corner.
- Prefer self-documenting names. Keep doc comments to a one-line purpose on exported helpers.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages, READMEs, specs.
- Use a hyphen for `term - description` separators; rephrase with commas, parentheses, or a colon.
