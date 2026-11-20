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
- **TypeScript:** package `typescript` is `~6.0.3` for `svelte-check`; lint / type-aware check still run on TS 7 via tsrs (bundled with vite-plus)
- **Validation:** `zod` v4 (same range as the MCP SDK) via `import * as z from 'zod/mini'` for disk JSON files in `src/disk/parse.ts` (the namespace import keeps tree-shaking; `import { z }` or classic `zod` bundles every locale). MCP tool inputs stay passthrough `fromJsonSchema` + authored errors; chrome stays dependency-free.
- **Lint / format / type check:** Vite+ `vp check` (Oxlint + Oxfmt + tsrs type check); config in `vite.config.ts`, which also enforces the mechanical code conventions. Unused files/deps: `pnpm knip` (separate from `vp check`)
- **Verify UI:** chrome and iframe behavior with `pnpm test:browser` (Playwright Chromium over the built bundle, `tests/browser/`); **F5** Extension Development Host (`fixtures/dev-workspace`) for Cursor-only checks. There is no `npm run dev` / `localhost:3000` app server
- **MCP register:** `vscode.cursor.mcp.registerServer` (stdio) only

## Chrome vs artboard

- Chrome: semantic `--cd-*` tokens from `src/webview/ui/theme.css` (the one place that maps the host's `var(--vscode-*)` theme values), shared primitives from `src/webview/ui/`, keyboard order, ARIA. Not React, not Tailwind-by-default, not shadcn.
- Artboard HTML is user/Agent content. Do not theme it as chrome. Never `eval` it in the parent. Iframe `sandbox="allow-scripts"`.

## Testing

Test gate on: `pnpm test` (`vp test`, Vitest; the `Test` command in `AGENTS.md`). A step that adds in-scope logic (parsers, disk schema, generation/hash, conflict handling) ships a passing test in the same diff. Vitest is the runner; do not run `/tests` to add or replace it. `/ci` owns `Verify`. What and how to test: `.claude/rules/09-tests.md`.

## Browser Verification

No app server: `Browser tests` in `AGENTS.md` (`pnpm test:browser`, local only) prove chrome and iframe behavior; F5 covers Cursor-only checks. How to write them: `.claude/rules/09-tests.md`.

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- File size follows `05-single-job`: split mixed concerns; do not split a one-job module to hit a line count

## Comments

See `.claude/rules/04-code-conventions.md` Comments.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages, READMEs, specs.
- Use a hyphen for `term - description` separators; rephrase with commas, parentheses, or a colon.
