# Fix: README canvas export trial

**Type:** Fix
**Status:** verified (checked against handoff canvas-20261018T160927516Z, 2026-10-18)
**Branch:** fix/readme-canvas-export-trial
**Fixes:** F-12

## The problem

`README.md` still describes the 0.1 single-artboard export in three places. Since 6e, an export writes every frame:

```
handoff/<exportId>/
  IMPLEMENT.md
  canvas.html
  tokens.json
  <group-folder>/<frame-id>/index.html
```

| Line | Says today | Wrong because |
|---|---|---|
| 75–79 "Export to implement trial" | Design on "the active artboard"; confirm `handoff/<exportId>/{index.html,IMPLEMENT.md,tokens.json}`; implement from that one file | There is no root `index.html`; one file per frame plus `canvas.html`; `lastExport.frames` |
| 92 Limits | "One active artboard, no gallery; variants are new ids + `set_active_artboard`." | 0.2 shows every frame on one canvas |
| 95 Limits | "Handoff carries the whole document in `index.html`" | Each frame's `index.html` carries its whole document |

Someone following the trial looks for a file that isn't there (F-12).

## The fix

Edit `README.md` only, in three places:

1. **Trial steps 2–4 (lines 75–77):**
   - Step 2: design at least two frames via Cursor Agent (`set_artboard` / `update_artboard`), for example a desktop page and a mobile page, and lay them out with `place_frame` (with `group`).
   - Step 3: after `export_artboard` or **Export Handoff**, confirm that `.cursor-design/handoff/<exportId>/` contains `IMPLEMENT.md`, `canvas.html`, `tokens.json` and one `<group-folder>/<frame-id>/index.html` per frame. Also confirm `manifest.json` `lastExport.frames` lists every frame, and that the badge is still hidden. Mention that `canvas.html` opens in a browser as a view-only preview.
   - Step 4: implement from `IMPLEMENT.md` into `fixtures/dev-workspace/sample-app/` (one responsive page from desktop and mobile variants). Keep "Do not copy `.cursor-design/` into the app".
   - Steps 1, 5 and 6 keep their meaning. In step 5, "Edit `artboards/<id>.html`" becomes "Edit any frame's `artboards/<id>.html`".
2. **Trial record (lines 81–83):** keep the `sample-app` run instructions and the `--ignore-workspace` note. Label the 2026-09-12 lines as the 0.1 trial, and add one line: "0.2 canvas trial: 2026-10-18 (6f dogfood: four frames exported clean, responsive sample-app built from the handoff)."
3. **Limits:**
   - Line 92 becomes: "One canvas per workspace folder; every artboard file is a frame on it. `set_active_artboard` still picks the frame that `read_artboard` and `handoff_status` default to."
   - Line 95 starts with "Each frame's `index.html` carries its whole document" and keeps the rest of the bullet (no CSS/JS split; Phase 3 lock; assets copied manually; `tokens.json` passed through).

Must not break:
- Every other README section stays unchanged: the tool list (lines 21–28, already correct), Install, Develop, Commands, and the other Limits bullets.
- No product code, rules, skills or `AGENTS.md` changes.
- No claim that isn't true of shipped behavior. The `handoff_status` field list in line 28 stays as it is.

## Build steps

- [x] **1. Update the three README spots.**
  - Done when:
    - `grep -n "{index.html,IMPLEMENT.md,tokens.json}" README.md` and `grep -n "One active artboard, no gallery" README.md` both return nothing.
    - The trial names `canvas.html`, `<group-folder>/<frame-id>/index.html` and `lastExport.frames`.
    - `git diff --stat` shows only `README.md` among tracked product and doc files (spec and ledger files excepted).

## Verify

- Read the "Export to implement trial" section against a real handoff folder, for example `.cursor-design/handoff/canvas-20261018T160927516Z/` in the fixture. Every file it tells you to confirm exists there.
- No build or test impact (docs only). Run `pnpm lint` once as a sanity check.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":3866,"specSha256":"cbc8f5ca8965c0b4ffe76ef38c96f37fb76a3cfab5d0182386b3194ade97af53","branch":"refs/heads/fix/readme-canvas-export-trial","head":"182cc5afa05a1c0a016753bc0bf3904bfa07c0ff","baseRef":"refs/heads/main","baseCommit":"182cc5afa05a1c0a016753bc0bf3904bfa07c0ff","sourceTree":"79a645fab67bab24c936c87989a543f0d76fcbd9","absentOptional":[]} -->
