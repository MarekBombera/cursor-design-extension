# Build Plan

Ordered MVP phases from Notion section 12 and `.cursor/rules/01-phase-protocol.mdc`. Details belong in `/feature`. Do not add items outside that spec.

## Your features

- [x] 1. **Phase 0 Bootstrap** - F5 Extension Host, empty Artboard panel, `registerServer` on activate, no CSP errors
- [x] 2. **Phase 1 Disk to pixels** - `.cursor-design/` HTML save refreshes the nested iframe (~200ms); generation bumps
- [x] 3. **Phase 2 MCP loop** - `set_artboard` / `update_artboard` / `read_artboard` / `list_artboards` / `set_active_artboard`; `baseGeneration` conflicts; MCP-offline banner
- [x] 4. **Phase 3 Export** - `export_artboard` + `handoff_status` stale mark; `IMPLEMENT.md` usable for Vite + plain HTML sample
- [x] 5. **Phase 4 Release polish** - MIT, honest limits

## 0.2 Interact

From the Notion 0.2 page: https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e

- [ ] 6. **0.2 Interact canvas** - pan/zoom the live artboard; Interact is the default; disk and export HTML stay pristine
  - [x] 6a. **Blob inject** - clip well + CSSOM `translate/scale` on the host iframe (origin `0 0`); gesture-forwarding runtime + chrome CSP nonce injected only at blob-build; pinch / ctrl+wheel forwarded as an allowlisted typed message; chrome zooms from the top-left within 50–200%; `data-cd-*` only; export/handoff asserts no inject junk (no strip)
  - [ ] 6b. **Gestures + zoom math** - zoom around the cursor; plain wheel pans only when the artboard cannot scroll that way (nested-scroll walk in runtime); clamps; unit tests for zoom math, clamps, nested-scroll walk
  - [ ] 6c. **Host zoom chrome** - zoom menu (50–200%); ready-handshake; chrome-persisted zoom survives refresh; empty/error disables menu; F5 dogfood at 50%/100%
