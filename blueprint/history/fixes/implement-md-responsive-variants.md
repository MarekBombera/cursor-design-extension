# Fix: IMPLEMENT.md responsive variants

**Type:** Fix
**Status:** verified (F5 IMPLEMENT.md check passed 2026-10-18, export canvas-20261018T160927516Z)
**Branch:** fix/implement-md-responsive-variants

## The problem

The canvas handoff's `IMPLEMENT.md` (written by `buildCanvasImplementMarkdown` in `src/disk/handoff.ts`, shipped in 6e) contains this instruction:

> 4. Frames are separate documents. Never merge their CSS or JS into one document. Each frame's `width` is the viewport it was designed at.

On a multi-frame canvas, a desktop frame and a mobile frame of the same page are the normal case, and the correct implementation is one responsive page. Instruction 4 tells the implementer the opposite. It also reads as "fix `body` at the frame width".

Evidence: 6f dogfood, 2026-10-18 (export `canvas-20261018T152500728Z`). The implementing Agent had to break instruction 4 to build `ref-desktop` + `ref-mobile` + two section frames as one responsive `sample-app` page, and it reported the instruction as wrong. It also had no guidance for section frames that exist only at 1280 (no narrow variant).

The rest of that report's "missing" items (only `ref-*`, the `sample-app` entry, the breakpoint, section order) were task-specific instructions from the Agent prompt. They are not handoff content, and this fix does not add them.

`project-overview.md` Handoff says "Frames are never merged into one document (their CSS/JS would collide)." That sentence sits next to "every exported `index.html` stays byte-equal" and describes the export tree, which this fix keeps unchanged. The new instruction 4 is scoped to "the implemented app", so the two do not conflict.

## The fix

Replace the instruction 4 line in the `buildCanvasImplementMarkdown` template, and only that line, with this one static line. Emit it as a single physical line: no wrapping, no newline inside it, and no variation by frame count, widths or groups. In the TypeScript template literal, the backticks around `width`, `group` and `body` are escaped as `\``, like the surrounding lines.

```
4. Each frame is a complete design at its `width`. In the implemented app, frames that show the same page at different widths (for example desktop and mobile, usually in the same `group`) are variants: build one responsive page that matches each frame at its width, combining their styles with media queries instead of pasting each frame's CSS and JS side by side, and keep each frame's classes and JS behavior. If it is unclear which frames are variants of one page, ask the user. Frames with no narrow variant should adapt to small screens in the implemented app. Never hard-code a frame's width on `body`.
```

The rest of the `## Instructions` section must stay byte-identical. Rendered (constants substituted), the full section after the fix is exactly:

```
## Instructions

1. Call `handoff_status` first. If `stale` is true, call `export_artboard` again (it exports the whole canvas) before implementing.
2. If MCP is unavailable, compare each frame's `hash` above with `.cursor-design/artboards/<id>.meta.json` `hash`, and the frame list with `.cursor-design/artboards/*.html`. On any difference, re-export, or ask the user to run **Export Handoff**.
3. Implement each frame from its own `index.html` (HTML+CSS+JS inline), not from screenshots or `canvas.html`.
4. <the new instruction 4 text above, after "4. ">
5. Target the user's app entry files. Never copy `.cursor-design/` into the app.
6. Keep semantic structure, classes, and behavior.
7. Assets referenced as `assets/...` resolve against `.cursor-design/assets/`. Copy them manually.
```

The document ends with a single trailing newline after instruction 7, as today.

Must not break:
- Instructions 1–3 and 5–7, their numbering, and every section before `## Instructions` stay byte-identical. Instruction 3 is not edited; it still holds when variants are merged.
- No change to export behavior, the handoff tree, `canvas.html`, the manifest, or staleness. Frame `index.html` files stay pristine.
- Do not edit `project-overview.md`, the plans, `.cursor/rules/`, skills, `AGENTS.md` (including Commands), README, the 6e archive (`blueprint/history/features/06e-canvas-export.md`), or handoffs already on disk.

## Build steps

- [x] **1. Replace instruction 4 and pin the whole Instructions section.**
  - Edit only the instruction 4 line of the template in `buildCanvasImplementMarkdown` (`src/disk/handoff.ts`).
  - In `src/disk/handoff.test.ts`, extend the existing test `buildCanvasImplementMarkdown orders sections and frames, collapses newlines, lists paths`:
    - Assert that the output's text from `## Instructions\n` to the end equals, exactly, the rendered section quoted in The fix (with the new instruction 4 in place) plus the trailing newline. Write that expected string as a literal in the test, not built from the same constants.
    - Assert that the output does not contain `Never merge their CSS or JS`.
    - Add these assertions only. Do not rewrite the test's fixture frames or its existing assertions.
  - Done when:
    - The extended test passes.
    - The full runner passes: `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`. This runner is the step's command; do not add it to `AGENTS.md`.
    - `pnpm check-types`, `pnpm lint` and `pnpm compile` pass, and `dist/mcp.js` exists.

## Verify

- Runner, `pnpm check-types`, `pnpm lint` and `pnpm compile` pass, and `dist/mcp.js` exists.
- F5 on `fixtures/dev-workspace` (trusted folder, artboard files present): write one new handoff with **Export Handoff** or MCP `export_artboard`. Open its `handoff/canvas-*/IMPLEMENT.md` and confirm instruction 4 is the new single line and instructions 1–3 and 5–7 are unchanged.

## Notes

- After this fix merges, `/complete` ticks 6f in `build-plan.md` with the 6f dogfood report (2026-10-18) as evidence. That run passed export-clean and the implement pass, and its only failure was the instruction-4 conflict this fix removes. No re-dogfood is part of this fix.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":6097,"specSha256":"ebc9d889fff06722bf617b54d75f7d7004b25d945f9e51b419417d03279184e7","branch":"refs/heads/fix/implement-md-responsive-variants","head":"a82d2c3f4e49c91f4db45fc17acb7bab6649bef5","baseRef":"refs/heads/main","baseCommit":"a82d2c3f4e49c91f4db45fc17acb7bab6649bef5","sourceTree":"90b73d4c352ff8f3df0e70ae1580279c5947e8f9","absentOptional":[]} -->
