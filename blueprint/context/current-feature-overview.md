# README canvas export trial - Overview for review

Source of truth: `blueprint/history/fixes/readme-canvas-export-trial.md`. This file is the steering summary, not the build spec.

## TL;DR

The README's "Export to implement trial" and two Limits bullets still described the 0.1 single-artboard export, so anyone following the trial looked for a root `index.html` that no longer exists. They now describe the 0.2 canvas export. Docs only; fixes F-12.

## What you will see

In `README.md`:
- **Trial step 3** confirms that `handoff/<exportId>/` holds `IMPLEMENT.md`, `canvas.html`, `tokens.json` and one `<group-folder>/<frame-id>/index.html` per frame, and that `lastExport.frames` lists every frame.
- **Trial steps 2, 4 and 5** design two or more frames (for example desktop and mobile), implement one responsive page into `sample-app/`, and edit any frame to see the badge.
- **The trial record** labels the 2026-09-12 run as the 0.1 trial and adds the 2026-10-18 0.2 canvas trial (6f dogfood).
- **Limits** now say one canvas per folder, every artboard is a frame, and each frame's `index.html` carries its whole document.

## Out of scope

Tool list, Install, Develop, Commands, other Limits bullets, and any code, rules or skills.

## Glossary

| Term | Why it exists |
|---|---|
| Frame | One artboard file placed on the canvas |
| Handoff | The `handoff/canvas-*/` folder an implementing Agent builds from |

## Your actions

Run `/audit` sometime to move F-12 from `fixed` to `closed`. It's a P3, so it doesn't block anything.

## Done means

Every file the README trial tells you to confirm exists in a real 0.2 handoff (checked against `canvas-20261018T160927516Z`).
