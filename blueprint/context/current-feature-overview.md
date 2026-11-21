# System map charts parse - Overview for review

> **Generated file.** Human-facing steering summary of the active work item:
> same content as `current-feature.md`, trimmed. Written at `/feature` when the
> spec is created, and kept current if the spec is revised. `/complete` may
> polish this into the archive-ready one-pager; it is not the first write.
> Open in Markdown preview to render the diagrams.

Source of truth: `blueprint/history/fixes/system-map-charts-parse.md`. This file is the steering
summary, not the build spec.

## TL;DR

8 of the 15 diagrams in `blueprint/context/system-map.md` showed a mermaid parse error in Markdown
preview and on GitHub. All 15 now parse and render. Docs only: no code, message or flow change.

## What was wrong

- **7 sequence charts** (8e, Agent edit to live frame, 8d1, 9d, 9f, 8f1, Export): a `;` inside a
  message or note ends a mermaid statement, so the rest of the line broke the chart.
- **The Runtime map** (flowchart): edge labels with `(` in them weren't quoted, so mermaid read
  them as node shapes.

## What changed

- 16 `;` became `,`, or `.` where two clauses needed separating. 5 Runtime map edge labels are now
  quoted (`-->|"…"|`). Every arrow, participant and message name is unchanged.
- The Chart checklist gains item 7, **Valid mermaid**, so new charts avoid both traps and get
  parsed before they're written.

## Your actions

None.

## Done means

A scratch `mermaid.parse` check (mermaid 11.4.1 with jsdom, not a repo dependency) prints `ok` for
all 15 charts, and `pnpm verify` exits 0.
