# Coding Standards

> **Coding SoT is `.cursor/rules/`**, not this file. Read `00-cursor-design-core.mdc` through `07-vscode-extension.mdc` before changing product code. Skills: `cursor-design-build`, `cursor-design-agent-loop`.
>
> This file is a Blueprint pointer plus a short summary so `/implement` does not load React/Next defaults. Do not duplicate those rules here.

This is a **Cursor/VS Code extension** (WebviewPanel + local MCP). Not Next.js, React, SvelteKit, TanStack Start, or a Chrome extension.

## Stack (locked)

- **Package manager:** `pnpm`
- **Host:** TypeScript + esbuild (`dist/extension.js`, `external: ['vscode']`)
- **MCP process:** TypeScript + esbuild (`dist/mcp.js`); package `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`
- **Chrome:** Svelte 5 + Vite, no SvelteKit. Artboard: nested sandboxed HTML iframe
- **Lint / format:** `oxlint`, `oxfmt`
- **Verify UI:** **F5** Extension Development Host (`fixtures/dev-workspace`). There is no `npm run dev` / `localhost:3000` app server
- **MCP register:** `vscode.cursor.mcp.registerServer` (stdio) only

## Style (summary of 04)

- ES6 arrow functions. No `function` declarations except class methods / `constructor`, or the VS Code entry shape the API requires.
- Names say what the thing is: `error` not `err`, `artboard` not `ab`, `payload` not `d`.
- Exported helpers, MCP handlers, and disk readers/writers take explicit return types.
- Helpers with 3+ parameters take one object (exceptions: ordered coords, stdlib callbacks, platform APIs, local test factories).
- Disk layout, schema version, and MCP tool names live in one module each. Do not re-type `.cursor-design/` path segments or tool name strings.

## Module jobs (summary of 05)

One job per function. Split host / MCP / disk lib / webview when a module grows a second hero.

| Kind | Lives in | Owns |
|---|---|---|
| Extension host | `src/` | panel, commands, MCP register, watchers, `postMessage` |
| MCP process | `src/mcp/` | tool handlers; disk I/O; no UI |
| Disk SoT | shared lib | artboard CRUD, active pointer, generation/hash |
| Webview chrome | `src/webview/` | Svelte chrome + iframe `srcdoc`; no MCP, no workspace fs |

## Errors, host, ponytail (06, 07, 03)

- Named `Error` subclasses or a small discriminated return at boundaries. MCP execution failures: tool result `isError: true` with a next step, not a protocol crash. No stacks/secrets/absolute sensitive paths in UI or MCP text. Full detail: OutputChannel / MCP stderr. See `06-error-handling.mdc`.
- Host: no `activationEvents: ["*"]`; one panel (reveal, don't stack); disposables on `context.subscriptions`; `webview.html` is a complete document; `localResourceRoots` = extension media only. See `07-vscode-extension.mdc`.
- Smallest correct change. No new deps, no speculative abstractions. Deliberate ceilings get a `ponytail:` comment. See `03-ponytail.mdc`.

## Chrome vs artboard

- Chrome: `var(--vscode-*)` theme tokens, keyboard order, ARIA. Not React, not Tailwind-by-default, not shadcn.
- Artboard HTML is user/Agent content. Do not theme it as chrome. Never `eval` it in the parent. Iframe `sandbox="allow-scripts"`.

## TypeScript

- Strict mode. No `any`; use `unknown` and narrow (`catch (error: unknown)`).
- No `: JSX.Element` / `: React.JSX.Element` on Svelte wrappers.
- Reusable types only if used in 2+ places or they are a real domain type. Put the type next to the owner.

## Testing

The blueprint installs no extra test runner. Testing is opt-in. The switch is a `test` command in the Commands section of `AGENTS.md`. Declare one and tests become a gate for logic-bearing steps; leave it out and the loop verifies with F5, compile, and other evidence already listed.

`package.json` may already have `vscode-test`. That does **not** turn the Blueprint test gate on until Commands in `AGENTS.md` lists it. `/tests` owns that declaration. `/ci` owns a `Verify` command.

- **What to test:** pure logic where a wrong answer is possible (parsers, disk schema, generation/hash, conflict handling). Assert inputs/outputs and edge cases (empty, missing, malformed).
- **What not to test:** Svelte chrome and the artboard iframe as brittle unit tests. Verify those with F5 and compile.
- When a runner is configured: a step that adds in-scope logic ships a passing test in the same diff. Empty suite should fail, not pass.
- Test files live next to source (`feature.test.ts`). `*.test.ts` covers the extracted util, not the VS Code `activate` wrapper.
- Stack binding: TypeScript extension. If/when a test command is declared, mock disk/MCP boundaries, not a web-app ORM or React tree.

## Browser Verification

There is no web app on `localhost:3000`. UI proof is **F5** in Cursor (Extension Development Host + webview).

- `/browser-tests` remains the explicit opt-in for a harness. Do not add Playwright mid-feature to pretend this is a Next app.
- When `Browser tests` is declared in `AGENTS.md`, use it for stable behavioral done-whens only. It does not replace F5 for webview CSP, MCP registration, or Extension Host behavior.
- Browser tests are not part of default Verify/CI unless chosen separately.

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- File size follows `05-single-job.mdc`: split mixed concerns; do not split a one-job module to hit a line count

## Comments

Write code that explains itself; comment only what the code cannot say.

- Comment the **why**, not the **what**. Delete any comment that restates the code.
- No banner/header blocks or step-by-step narration of obvious code.
- A comment earns its place for a non-obvious decision, a gotcha, why a value is what it is, or a link to the spec. Use `ponytail:` when cutting a known corner.
- Prefer self-documenting names. Keep doc comments to a one-line purpose on exported helpers.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages, READMEs, specs.
- Use a hyphen for `term - description` separators; rephrase with commas, parentheses, or a colon.
