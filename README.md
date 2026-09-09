# cursor-design

Agent-driven live HTML artboard for **Cursor** — Claude Design–style canvas without in-panel chat.

- **Panel:** Webview artboard (Svelte chrome + sandboxed HTML iframe — chrome lands after Phase 0)
- **Brain:** Cursor Agent (your subscription) via local MCP + disk under `.cursor-design/`
- **Not:** a Next.js app, Chrome extension, or in-extension LLM calls

## Status

Phase 0: empty Artboard panel, `vscode.cursor.mcp.registerServer` stub (zero tools), F5 against `fixtures/dev-workspace`.

Spec (source of truth): [Notion — Cursor Design](https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4)

## Develop

```bash
pnpm install
pnpm compile
```

Confirm `dist/mcp.js` exists after compile or the watch/`preLaunchTask` build. F5 will not register a working stdio server without it.

In Cursor: open this folder → **F5** (Run Extension). The Extension Development Host opens `fixtures/dev-workspace` (positional folder arg in `.vscode/launch.json`). The panel does **not** open on startup.

Then in the **Extension Development Host** window (not this repo window):

1. Command Palette → **Cursor Design: Open Artboard** — empty chrome, no CSP errors in the **webview** console.
2. Check MCP: Settings → MCP. Server name `cursor-design`. Activation is `onStartupFinished`, so it registers without opening the panel.
3. **Allowlist** the server if Cursor prompts. Settings may show **0 tools** until you toggle the server off/on (known Cursor quirk). Phase 0 ships zero tools on purpose.

Commands:

- **Cursor Design: Open Artboard** — open/reveal the empty panel
- **Cursor Design: Reveal Design Folder** — reveal `.cursor-design/` if it exists (does not create it)
- **Cursor Design: Export Handoff** — stub message until Phase 3

Output: **View → Output → Cursor Design**.

Agent entry: [`AGENTS.md`](./AGENTS.md)

Workflow overlay: [AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint) (plans and review gates, not the product stack).

## License

MIT — see [LICENSE](./LICENSE).
