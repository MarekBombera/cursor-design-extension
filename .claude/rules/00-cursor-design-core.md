---
description: Sacred product constraints and build protocol for the cursor-design extension. Always apply.
alwaysApply: true
---

# Cursor Design: core constraints

You are building **cursor-design**: a Cursor/VS Code extension (WebviewPanel + local stdio MCP). Not a Chrome extension, not a web app.

## Sacred (never violate)

1. **Brain = Cursor Agent only.** Never call LLMs from the extension. Never use `vscode.lm` (lint). No model API keys.
2. **No in-extension chat.** Chat stays in Cursor Agent. Panel = artboard chrome + live HTML preview only.
3. **Disk is SoT:** workspace `.cursor-design/`. MCP process memory is not extension memory.
4. **Register MCP on activate** with `vscode.cursor.mcp.registerServer` (stdio). Never `vscode.lm.registerMcpServerDefinitionProvider`.
5. **No Next.js / TanStack Start / TanStack AI / SvelteKit / React** (lint bans the imports).
6. **Panel-only MVP:** no CustomTextEditor, no OS auxiliary window.
7. **Brand:** `cursor-design` (no Grok Build in v1 messaging).

## Build protocol

- Spec, then types, then gates, then code. Prove chrome and iframe behavior with `pnpm test:browser`; **F5** (Extension Development Host, `fixtures/dev-workspace`) for Cursor-only checks (CSP, MCP registration, Extension Host, webview hide/show, Cursor focus).
- The Notion spec (links in `AGENTS.md`) wins over conflicting chat. Do not invent features outside it; ask Bombic.
- After work: `pnpm verify`. Do not skip it.

## Agent tooling

- Notion MCP: fetch the spec before a feature.
- Context7: current VS Code / webview / MCP docs.
- Before webview or CSP work: `npx -y modern-web-guidance@latest search "<use case>"`, then retrieve.
- Svelte (chrome only): follow `08-svelte-chrome`. Svelte MCP `list-sections` / `get-documentation` before writing, `svelte-autofixer` after every edit until clean.
