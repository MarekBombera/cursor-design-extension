---
description: Sacred product constraints and build protocol for the vibeboard extension. Always apply.
alwaysApply: true
---

# Vibeboard: core constraints

You are building **vibeboard**: a Cursor/VS Code extension (WebviewPanel + local stdio MCP). Not a Chrome extension, not a web app.

## Sacred (never violate)

1. **Brain = Cursor Agent only.** Never call LLMs from the extension. Never use `vscode.lm` (lint). No model API keys.
2. **No in-extension chat.** Chat stays in Cursor Agent. Panel = artboard chrome + live HTML preview only.
3. **Disk is SoT:** workspace `.vibeboard/`. MCP process memory is not extension memory.
4. **Register MCP on activate** with `vscode.cursor.mcp.registerServer` (stdio). Never `vscode.lm.registerMcpServerDefinitionProvider`.
5. **No Next.js / TanStack / SvelteKit / React imports** (lint bans them).
6. **Panel-only MVP:** no CustomTextEditor, no OS auxiliary window.
7. **Brand:** `vibeboard` (Vibeboard Design).

## Build protocol

- Spec, then types, then gates, then code. Prove chrome and iframe behavior with `pnpm test:browser`; F5 for Cursor-only checks (`AGENTS.md` Commands).
- Shipped code is the source of truth. The Notion page and the active plan (`blueprint/build-plan.md` names it) are plans; implementation may decide differently. When it does, record the decision in the spec and update the Notion version page in the same work item (at `/complete` at the latest). Code > plan > chat. Do not invent features outside the plan; ask Bombic.
- Tooling recipes: `vibeboard-build` skill; Svelte: rule 08.
