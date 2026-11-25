# Contributing to Vibeboard

Thanks for helping. This file covers building, debugging and the manual checks; the user-facing docs live in [README.md](./README.md).

- Agent entry point: [`AGENTS.md`](./AGENTS.md)
- Spec (source of truth for plans): [Notion - Vibeboard](https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4)
- Workflow overlay: [AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint) (plans and review gates, not the product stack)

## Develop

```bash
pnpm install
pnpm compile
pnpm verify
```

Run `pnpm verify` before every commit. Confirm `dist/mcp.js` exists after compile or the watch / `preLaunchTask` build: F5 will not register a working stdio server without it.

In Cursor: open this folder → **F5** (Run Extension). The Extension Development Host opens `fixtures/dev-workspace` (positional folder arg in `.vscode/launch.json`). The panel does **not** open on startup.

Then in the **Extension Development Host** window (not this repo window):

1. Command Palette → **Vibeboard: Open Artboard**: chrome + disk preview, no CSP errors in the **webview** console.
2. Check MCP: Settings → MCP. Server name `vibeboard`. Activation is `onStartupFinished`, so it registers without opening the panel.
3. Allowlist `vibeboard` (toggle off/on if the tool count stays 0).

Output: **View → Output → Vibeboard**.

Browser tests (`pnpm test:browser`) and the chrome gallery (`pnpm gallery`) are described in [`AGENTS.md`](./AGENTS.md#commands).

## Showcase media

The README screenshots and the demo clip come from the real chrome with a stubbed host (`tests/browser/showcase.spec.ts`, artboards in `fixtures/showcase/`):

```bash
pnpm showcase
cd test-results/showcase/demo
ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=25,format=yuv420p" -c:v libx264 -crf 18 -preset slow -movflags +faststart ../demo.mp4
ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=20,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 ../demo.gif
```

Then copy `canvas.png`, `comments.png` and `edit.png` to `media/screenshot-*.png`, and `demo.gif` / `demo.mp4` to `media/`.

## Package

`pnpm vsix` writes `vibeboard-0.1.0.vsix` at the repo root. Install it with **Extensions: Install from VSIX…** or `cursor --install-extension <file>` / `code --install-extension <file>`.

## Export to implement trial

F5 in the Extension Development Host with `fixtures/dev-workspace` open:

1. Command Palette → **Vibeboard: Open Artboard**. No handoff badge.
2. Design at least two frames via your agent (`set_artboard` / `update_artboard`), for example a desktop page and a mobile page, and lay them out with `place_frame` (with `group`).
3. Call `export_artboard` (or Command Palette → **Vibeboard: Export Handoff**). Confirm `.vibeboard/handoff/<exportId>/` holds `IMPLEMENT.md`, `canvas.html`, `tokens.json`, and one `<group-folder>/<frame-id>/index.html` per frame, and that `.vibeboard/pages/page-1/manifest.json` `lastExport.frames` lists every frame. Badge still hidden. `canvas.html` opens in a browser as a view-only preview of the canvas.
4. In a second Agent session, open `.vibeboard/handoff/<exportId>/IMPLEMENT.md` (from `lastExport.exportId` in `.vibeboard/pages/page-1/manifest.json`) and implement into `fixtures/dev-workspace/sample-app/`: one responsive page from the desktop and mobile variants. Do not copy `.vibeboard/` into the app.
5. Edit any frame's `.vibeboard/pages/page-1/artboards/<id>.html` and save. Within ~200ms the panel badge shows `Handoff out of date. Re-export.`
6. Re-export. Badge clears. The previous handoff directory stays on disk.

Then `cd fixtures/dev-workspace/sample-app && pnpm install --ignore-workspace && pnpm dev` to view the implemented page. (`--ignore-workspace` is required because this repo has a root `pnpm-workspace.yaml`; without it, `pnpm install` no-ops and `vite` is missing.) 0.1 trial, observed 2026-09-12: Vite 8.3.0 served `index.html` at `http://localhost:5173/` (`Implement the exported artboard here.`).

## Verification history

- **0.1 trial:** 2026-09-12 (live F5 pass, steps 2–6 green; 6 handoffs on disk, `stale:false`, Vite 200 with latest implement).
- **0.2 canvas trial:** 2026-10-18 (6f dogfood: four frames exported clean, responsive sample-app built from the handoff).
- **0.3 verification:** 2026-11-18 (8i, agent-run: a headless Agent loop over real stdio MCP processes covering comments, sent, fresh process, resolve, stale, target missing, unchecked and a byte-equal export, plus a `.vsix` smoke; no manual Cursor run, earlier per-feature F5 passes cited or waived).
- **Smoke test:** 2026-11-20, Cursor 3.29.9 (agent-driven run on the packaged `.vsix`).

## Release history

- **0.1.0:** installable `.vsix` with an artboard panel, seven MCP tools, export handoff + stale badge, and documented v1 limits.
- **0.3:** Svelte chrome, frame drag and resize, and comments for the Agent (Comment mode, pins, Comments panel, Copy for Agent). 11 MCP tools.
- **0.4:** Edit mode with Undo / Redo. 11 MCP tools, unchanged.
- **0.5 (in progress):** pages (Pages menu, `list_pages`, `create_page`, `open_page`). 14 MCP tools.

See also [CHANGELOG.md](./CHANGELOG.md).
