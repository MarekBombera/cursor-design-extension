# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-11 [P3] unverified - Real clients may reject the 2020-12 advertised schema

**File:** src/mcp/mcpToolResult.ts
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: both)
**Why it matters:** `$schema` draft 2020-12, `additionalProperties: false`, `maximum` 2^53-1 reach Cursor / Copilot validators; untested in a real client.
**Suggested fix:** Settle at `/check` (Cursor F5). If it bites, delete `$schema` in `zodToolInput`'s `jsonSchema()`.
**Resolution:** Re-examined 2026-11-28 by independent review (claude-opus-5-5): SDK 2.4.0 itself requests `target: 'draft-2020-12'`, and the emitted schema carries `$schema` 2020-12, `additionalProperties: false` and `maximum` 2^53-1 as described; still no real-client evidence, stays unverified until `/check`.
