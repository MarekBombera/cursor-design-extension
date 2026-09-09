# Build Plan

Ordered MVP phases from Notion section 12 and `.cursor/rules/01-phase-protocol.mdc`. Details belong in `/feature`. Do not add items outside that spec.

## Your features

- [x] 1. **Phase 0 Bootstrap** - F5 Extension Host, empty Artboard panel, `registerServer` on activate, no CSP errors
- [x] 2. **Phase 1 Disk to pixels** - `.cursor-design/` HTML save refreshes the nested iframe (~200ms); generation bumps
- [ ] 3. **Phase 2 MCP loop** - `set_artboard` / `update_artboard` / `read_artboard` / `list_artboards` / `set_active_artboard`; `baseGeneration` conflicts; MCP-offline banner
- [ ] 4. **Phase 3 Export** - `export_artboard` + `handoff_status` stale mark; `IMPLEMENT.md` usable for Vite + plain HTML sample
- [ ] 5. **Phase 4 Release polish** - MIT, screenshots, honest limits
