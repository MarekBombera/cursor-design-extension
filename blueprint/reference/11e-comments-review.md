# 11e comments review

Report for build-plan item 11e1 (spec: `blueprint/context/current-feature.md`, archived by `/complete`). Question: can `CommentsState`, `PinThread` and `CommentPicker` become one comments module with a small interface? Sections: Baseline, Method, Map, Candidates, Disputed, Not proposed, Merge log, Picks, Re-measure. 11e2 builds the picks; 11e3 re-measures with the Method below.

## Baseline

Measured 2026-11-27 on `feature/comments-review-report` at `374d2ed` (no source change on the branch). Commands: Method.

**Size** (measured set, 21 files):

| Group | Files | Lines |
|---|---|---|
| State classes | `commentsState.svelte.ts` 206, `pinThread.svelte.ts` 236, `commentPicker.svelte.ts` 343 | 785 |
| Pure rules | `commentActions.ts` 330, `commentPick.ts` 189, `commentPopover.ts` 316, `commentsPanel.ts` 147, `pins.ts` 350 | 1,332 |
| Rule tests | `commentActions` 395, `commentPick` 300, `commentPopover` 277, `commentsPanel` 199, `pins` 431 | 1,602 |
| Views | `CommentCard` 401, `CommentPopover` 181, `CommentThread` 75, `CommentsPanel` 338, `Composer` 123, `PinChip` 42, `Pins` 167, `TargetRef` 84 | 1,411 |
| Total | 21 files | 5,130 (3,528 without tests) |

**Wiring:**

- `DesignPage.svelte`: 415 lines; 107 non-comment lines name a comments class, instance or view.
- Comment-UI save path: 14 lines in `App.svelte` name it; `DesignPage.svelte` `savable` is lines 191-197.

**Exports used outside their own file** (non-test importers, `.ts` / `.svelte.ts` / `.svelte`):

| File | Value used / exported | Type used / exported | Not used outside |
|---|---|---|---|
| 8 views (`default`) | 8 / 8 | 0 / 0 | none |
| `commentActions.ts` | 15 / 15 | 4 / 4 | none |
| `commentPick.ts` | 8 / 8 | 6 / 6 | none |
| `commentPopover.ts` | 13 / 13 | 2 / 4 | `DraftTarget`, `PopoverKeyAction` (types) |
| `commentsPanel.ts` | 8 / 8 | 2 / 2 | none |
| `pins.ts` | 13 / 15 | 3 / 3 | `pinPoint`, `pinLabel` (test-only) |
| `commentsState.svelte.ts` | 1 / 1 | 0 / 0 | none |
| `pinThread.svelte.ts` | 2 / 2 | 0 / 0 | none |
| `commentPicker.svelte.ts` | 2 / 2 | 0 / 0 | none |
| Total | 70 / 72 | 17 / 19 | 4 |

**Test-only exports:** 8 `@internal` in `src/`; 2 in the measured set (`pins.ts:162` `pinPoint`, `pins.ts:186` `pinLabel`).

**Class interfaces** (public members: fields, getters, methods without `#`; constructor not counted; from the Map):

| Class | Public | Used outside its file |
|---|---|---|
| `CommentsState` | 23 | 23 |
| `PinThread` | 20 | 18 (`anchors`, `flash` are not) |
| `CommentPicker` | 20 | 20 |

**Cross-class uses** (distinct reader-member pairs, Map): 66 = 5 write + 29 read + 30 call + 2 helper imports. By owner: `CommentsState` 23, `PinThread` 20, `CommentPicker` 21, helpers 2. By reader: `DesignPage` 58, `PinThread` 2, `CommentPicker` 4, `EditState` 2.

**Order constraints in `DesignPage.svelte`** (Map): 8 where order matters, 4 checked and order-free.

**Repo-wide quality-pass metrics:**

- **Unit:** 75 files, 926 tests.
- **Browser:** 13 spec files, 455 tests (no title runs in both projects): 231 gating, 220 gallery and 4 showcase entries (local only).
- **`vi.mock(` calls:** `canvasSnapshot` 3, `openArtboardPanel` 3, `pageOps` 2, and 1 each in `hostFs`, `artboardChromeHtml`, `frame/selector`, `registerVibeboardMcp`, `disk/comments`, `artboardEditFs`, `openPage` (10 files, 15 calls).
- **Files touched per feature** (all files): 10b `f8c842b` 61, 11c4 `b94834f` 13, 11d `374d2ed` 13.

**11e3 inputs:**

| File | Lines | `<script>` lines | `$effect` | Handlers |
|---|---|---|---|---|
| `Stage.svelte` | 636 | 336 | 2 | 6 |
| `Inspector.svelte` | 507 | 203 | 3 | 0 |

## Method

Run from the repo root. 11e3 reruns every command unchanged; where 11e2 renames instances or files, it also records the row with the new names.

- **Measured set:** `ls src/webview/{comment*,pin*,Comment*,Pin*,Composer,TargetRef}.*`; tests are the `*.test.ts` among them. Size: `wc -l` on that list.
- **DesignPage wiring:** `wc -l < src/webview/DesignPage.svelte`; `grep -vE '^\s*(//|<!--)' src/webview/DesignPage.svelte | grep -cE '\b(CommentsState|PinThread|CommentPicker|comments|pinThread|picker|CommentsPanel|CommentThread|CommentPopover|Pins)\b'`.
- **Save path:** `grep -cE '\b(draftSlot|latestComments|keptCommentDraft|savedCommentUi|readSavedCommentUi|saveCommentUi)\b' src/webview/App.svelte`; `savable`'s range runs from `grep -n 'export const savable' src/webview/DesignPage.svelte` to the next line that is `\t});`.
- **Exports:** the script below (scratchpad, not in the repo). Value exports are `export const|function|class|let`, type exports `export type|interface`, plus `default` per `.svelte` view. An export counts as used when a non-test file under `src/` other than its own imports it by name (multi-line, `import type` included) from a path that resolves to it.
- **Test-only exports:** `grep -rn '@internal' src --include='*.ts'` (`knip --production` skips `@internal`, so it reads 0).
- **Class interfaces and cross-class uses:** for each class, members are the distinct names matched by `/^\t(?:readonly\s+)?(?:get\s+)?(?!#)([a-zA-Z]\w*)\s*[:(=]/gm` over the text from `export class` to the end of the file, minus `constructor` (23 / 20 / 20 today). Uses: lines matching `(\b|#)<instance>\.<member>\b` in `DesignPage.svelte`, `editState.svelte.ts` and the other two class files, where `<instance>` is `comments`, `pinThread` or `picker` (`#pinThread`, `#picker`, `#comments` match through the `#` alternative); each hit read by hand for collisions. Tags: **write** = assignment or `bind:this` into the member; **call** = a method called or passed as a callback; **read** = any other access. A pair with both a read and a write counts as a write. Helper imports: `grep -rn 'canTakeFocus\|isTextEntry' src` minus tests.
- **Order constraints:** read `DesignPage.svelte` top to bottom; a constraint counts when swapping two adjacent calls or constructions would change state or messages (data dependency or an effect/event-phase rule).
- **Browser tests:** `pnpm exec playwright test -c tests/browser --list`, titles deduplicated across the `parallel` and `serial` projects (`perl -ne 'print "$1\n" if /^\s+\[[^\]]+\] › (.*)$/' | sort -u`), gallery and showcase counted apart (same method as `11f-test-review.md`).
- **Unit:** `pnpm test`. **`vi.mock(`:** `grep -rc --include='*.test.ts' 'vi.mock(' src | grep -v ':0$'`. **Files touched:** `git show --stat --format= <sha> | tail -1`.
- **11e3 inputs:** `wc -l`; `<script>` lines `awk '/^<script/{f=1} f{n++} /^<\/script>/{f=0} END{print n}'`; `grep -c '\$effect'`; handlers `grep -cE '^\s*(const|function) (handle|on)[A-Z]'`.
- **Guards:** `grep -lE 'comment|Comment|pin|Pin' tests/browser/*.spec.ts tests/browser/harness.ts`, then per spec `grep -cE` with each class pattern (Map > Guards).

Exports script (`node exports.mjs` from the repo root):

```js
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const walk = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
const isTest = (path) => path.endsWith('.test.ts');
const sources = walk('src').filter((path) => /\.(ts|svelte)$/.test(path) && !isTest(path));
const measured = readdirSync('src/webview')
	.filter((name) => /^(comment|pin|Comment|Pin|Composer\.|TargetRef\.)/.test(name))
	.map((name) => join('src/webview', name))
	.filter((path) => !isTest(path) && statSync(path).isFile());
const exportsOf = (path) => {
	const text = readFileSync(path, 'utf8');
	const value = [...text.matchAll(/^export (?:const|function|class|let) (\w+)/gm)].map((m) => m[1]);
	const type = [...text.matchAll(/^\s*export (?:type|interface) (\w+)/gm)].map((m) => m[1]);
	if (path.endsWith('.svelte') && !path.endsWith('.svelte.ts')) value.push('default');
	return { value, type };
};
const resolves = (fromFile, specifier, target) => {
	if (!specifier.startsWith('.')) return false;
	const base = resolve(dirname(fromFile), specifier);
	return [base, `${base}.ts`, `${base}.svelte.ts`].includes(resolve(target));
};
const importsOf = (path) =>
	[...readFileSync(path, 'utf8').matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/g)].map((m) => {
		const names = new Set();
		const braces = m[2].match(/\{([\s\S]*)\}/);
		for (const part of braces ? braces[1].split(',') : []) {
			const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
			if (name) names.add(name);
		}
		const head = m[2].replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
		if (head && !head.startsWith('*')) names.add('default');
		return { specifier: m[3], names };
	});
const imports = new Map(sources.map((path) => [path, importsOf(path)]));
for (const file of measured) {
	const { value, type } = exportsOf(file);
	const used = (name) =>
		sources.some(
			(other) =>
				other !== file &&
				imports.get(other).some((entry) => entry.names.has(name) && resolves(other, entry.specifier, file)),
		);
	const unused = [...value, ...type].filter((name) => !used(name));
	console.log(
		`${file}\tvalue ${value.filter(used).length}/${value.length}\ttype ${type.filter(used).length}/${type.length}\tnot used outside: ${unused.join(', ') || '-'}`,
	);
}
```

**Review** (Step 3): two reviewers in parallel, `subagent_type: Plan` (no Edit or Write), `effort: high`, one Opus 5.5 and one Sonnet 5.5, neither seeing the other. Inputs: this report through Map, the measured-set and read-only-context paths, rules 03, 05, 08, the build-plan Quality pass text, the spec's Out of scope, tier rules and candidate format.

## Map

### Files

- `commentsState.svelte.ts`: comment list, load error, panel open, reply / status / copy actions and their answers, copy feedback timer, `now` ticker, comments live region text. Matches rule 08.
- `pinThread.svelte.ts`: anchor answers per frame, pin layout, panel items, open thread and held (restored) thread, jump + flash, implicit thread close with focus to the stage; exports the focus gate `canTakeFocus`. Matches rule 08, plus it also builds the panel's `commentItems` (rule 08 lists panel items under `commentsPanel.ts`, the pure rule it calls).
- `commentPicker.svelte.ts`: mode (one setter), hover and pick for both Comment and Edit mode, add-comment draft and held draft, popover focus, mode keys; exports `isTextEntry`. Mismatch: rule 08 says "mode, hover, pick, add-comment draft" but the class name says comments only; its own comment (`commentPicker.svelte.ts:47`) says it also owns Edit mode.
- `commentActions.ts`: reply / status / copy / copy-open request and answer rules. Matches.
- `commentPick.ts`: `ChromePick`, mode choice, pick message step, mode-key verdict, `pickCounts`. Matches.
- `commentPopover.ts`: add-comment draft lifecycle, popover anchor, held-draft restore, `keptCommentDraft`. Matches.
- `commentsPanel.ts`: panel items, summary, `frameLabel`, `commentsText`, `liveRegionText`. Matches.
- `pins.ts`: anchor state, pin layout, badges, jump target, open-thread keep, held-thread resolve, `liveAnchor`, `commentNumber`. Matches.
- Views: `CommentCard` (panel card and thread body via `shell`), `CommentPopover` (add form), `CommentThread` (thread popover shell), `CommentsPanel` (panel list and copy-open), `Composer` (the one textarea composer), `PinChip` (pin face), `Pins` (pin layer, `focusPin`), `TargetRef` (jump chip). Match.
- Read-only context: `editState.svelte.ts` takes `CommentPicker` (`editState.svelte.ts:57`) and imports `isTextEntry` (`:4`); `canvasState.svelte.ts` is taken by `PinThread` and `CommentPicker` (reads `committedView`, `displayFrames`, `frames`, `framesKnown`, `iframes`, `viewportWidth/Height`, `jumpFrame`; calls `sendToFrame`, `commitStageView`).

### Members

`CommentsState` (23 public):

- `comments` state: `pinThread.svelte.ts:48,58,64,82,111,115,149,201`.
- `commentsError` state: `DesignPage.svelte:274,304`. `commentsKnown` state: `pinThread.svelte.ts:115`.
- `actions` state: `DesignPage.svelte:306,362`. `copyOpen` state: `:315`. `copyFeedback` state: `:314,371,372`. `announcement` state: `:405`. `commentsPanelOpen` state: `:265,302`. `now` state: `:305,361`.
- `copyBlocked` derived: `:313,370`. `summary` derived: `:266,316`. `savedReplyDrafts` getter: `:196`.
- Methods: `applyCommentsUpdated` `:95`; `handleReplyOpen` `:308,365`; `handleReplyInput` `:309,366`; `handleReplyCancel` `:310,367`; `handleReplySubmit` `:311,368`; `handleToggleStatus` `:312,369`; `handleCopy` `:317,373`; `handleCopyOpen` `:318`; `handleToggleCommentsPanel` `:270`; `handleActionAnswer` `:124,130,134`; `handleCopyOpenAnswer` `:125,135`.

`PinThread` (20 public):

- `anchors` state: none outside. `flash` state: none outside.
- `openThreadId` state: `DesignPage.svelte:195,346,352`. `threadFocusOnOpen` state: `:364`. `heldThreadId` state: `DesignPage.svelte:195` (read), `commentPicker.svelte.ts:251` (write).
- View handles: `pinsView` `DesignPage.svelte:343` (bind); `stage` `DesignPage.svelte:321` (bind), `commentPicker.svelte.ts:150` (read).
- Derived: `pins` `:344`; `commentItems` `:303`; `flashOutline` `:334`; `openPin` `:349,350`; `openComment` `:349,351`.
- Methods: `sendAnchors` `:96`; `resetFrameAnchors` `:150`; `handleAnchorRects` `:159`; `keepLiveAnchors` `:81`; `closeThreadImplicitly` `commentPicker.svelte.ts:261`; `handlePinOpen` `:207`; `handleThreadClose` `:363`; `handleJump` `:307`.

`CommentPicker` (20 public):

- `picking` state: `DesignPage.svelte:193,263,264,280,281,331`; `editState.svelte.ts:86,135,153,167,190,253,315,331,342`.
- `draft` state: `DesignPage.svelte:345,377,380,381,383`. `heldDraft` state: `:194` (read), `:206` (write). `popover` view handle: `:379` (bind).
- Derived: `hoverOutline` `:332`; `pickOutline` `:333`; `draftAnchor` `:377,384`; `canStep` `:387`. Getter: `savedDraft` `:194`.
- Methods: `keepLiveState` `:80`; `handleChooseMode` `:269`; `handleCancel` `:389`; `handleDraftInput` `:382`; `restoreHeldDraft` `:87`; `handleAdd` `:388`; `handleCommentAnswer` `:117,123`; `handlePickMessage` `:147`; `stepPick` `:289,290,390,391`; `handleKeydown` `:201`; `handleFrameKey` `:174`.

### Cross-class uses

Pairs (reader, owner.member), 66 total. Every `DesignPage` use above is a pair; the rest:

- **Writes (5):** `DesignPage` bind `pinThread.stage` (`:321`), bind `pinThread.pinsView` (`:343`), bind `picker.popover` (`:379`), `picker.heldDraft = undefined` (`:206`); `CommentPicker` `this.#pinThread.heldThreadId = undefined` (`commentPicker.svelte.ts:251`).
- **Calls from a class (1):** `CommentPicker` → `pinThread.closeThreadImplicitly()` (`commentPicker.svelte.ts:261`).
- **Reads from a class (4):** `PinThread` → `comments.comments`, `comments.commentsKnown` (`pinThread.svelte.ts:48-201`, `:115`); `CommentPicker` → `pinThread.stage` (`commentPicker.svelte.ts:150`); `EditState` → `picker.picking` (`editState.svelte.ts:86-342`, 9 lines).
- **Helper imports (2):** `canTakeFocus` `pinThread.svelte.ts:21` → `commentPicker.svelte.ts:35,123`; `isTextEntry` `commentPicker.svelte.ts:43` → `editState.svelte.ts:4,314`.
- **Totals by tag:** write 5, read 29 (`DesignPage` 25 + classes 4), call 30 (`DesignPage` 29 + 1), helper 2.

### Order constraints (`DesignPage.svelte`)

Order matters (8):

- **O1. Construction** `:72-76`: `CanvasState`, `CommentsState`, `PinThread`, `CommentPicker`, `EditState`. `PinThread` takes canvas and comments, `CommentPicker` canvas and pinThread, `EditState` canvas and picker (`CommentsState` takes no class); `PinThread`'s `$effect.pre` (`pinThread.svelte.ts:100,106`) reads canvas and comments on creation. Stated `:69-70`.
- **O2. `applyCanvas`** `:84-89`: `canvas.applyCanvasUpdated` first, then `keepLiveCommentState`, `picker.restoreHeldDraft`, `edit.handleFramesChanged`; all read the new frames. Stated only for the hold (`commentPicker.svelte.ts:206-207`); the keep-then-restore order is not stated in code.
- **O3. `applyComments`** `:95-96`: `comments.applyCommentsUpdated` before `pinThread.sendAnchors` (which reads `#comments.comments`, `pinThread.svelte.ts:149`). Not stated in code.
- **O4. `cd:ready`** `:147-151`: `picker.handlePickMessage` (sends `cd:mode`) before `pinThread.resetFrameAnchors` (sends `cd:anchors`). Stated `:148`. `edit.handleFrameReady` after: order-free (drops drafts only).
- **O5. `cd:pick`** `:147,152-153`: `picker.handlePickMessage` before `edit.handlePick`, which reads `picker.picking.pick`. Stated `editState.svelte.ts:248`.
- **O6. Start** `:217-222`: `applyCanvas` before `applyComments` so the list finds its frames. Stated `:216`.
- **O7. `handleRenderError`** `:211-213`: `canvas.handleRenderError` before `keepLiveCommentState` and `edit.handleFramesChanged`. Not stated in code.
- **O8. Window keydown phase** `:228-229` (`<svelte:window>`): `edit.handleHistoryKeydown` on capture stops propagation, so `picker.handleKeydown` never sees an undo key. Stated `editState.svelte.ts:322`.

Checked and order-free (4): `keepLiveCommentState` `:80-81` (picker and pinThread touch disjoint state); the `ui:error` fan-out `:122-127` (request ids never cross-match, stated `:120-121`); `handlePinOpen` `:206-207`; `handleWindowKeydown` `:200-201`.

### Save path

- `App.svelte:15-16` reads the saved comment UI once (`readSavedCommentUi`, `hostBridge.svelte.ts:52`, parsed by `savedState.ts:91` `parseSavedCommentUi`).
- `App.svelte:43-57` `stagePage`: reads `page.savable()`, keeps the draft slot (`keptCommentDraft`), hands mode, slot, latest comments and saved UI to `nextPageStart`.
- `App.svelte:104-116` the one save `$effect`: `page.savable()` then `saveCommentUi` (`hostBridge.svelte.ts:57`).
- `DesignPage.svelte:191-197` `savable`: `picker.picking.mode`, `picker.heldDraft ?? picker.savedDraft`, `pinThread.openThreadId ?? pinThread.heldThreadId`, `comments.savedReplyDrafts`. Reads all three classes.
- `pageStart.ts:65` `isPageComments` guards `applyComments` (`DesignPage.svelte:92`).

### Guards

Class patterns (`grep -cE` per spec): `CommentsState` `Reply|Resolve|Reopen|Copy|commentsPanel|comments panel|banner`; `PinThread` `data-cd-comment-thread|pinButton|thread|[Jj]ump|flash`; `CommentPicker` `Comment mode|popover|draft|cd:mode|pressMode|'c'|Escape`.

- `commentsPanel.spec.ts`: CommentsState 62, PinThread 72, CommentPicker 13.
- `commentPopover.spec.ts`: CommentsState 8, CommentPicker 80.
- `pins.spec.ts`: CommentsState 2, PinThread 24, CommentPicker 10.
- `picking.spec.ts`: CommentPicker 23. `editMode.spec.ts`: CommentPicker 21 (Edit-mode pick through the picker).
- `pages.spec.ts`: CommentsState 7, PinThread 14, CommentPicker 12 (page switch keeps draft, thread, reply drafts).
- `pagesMenu.spec.ts`: PinThread 1, CommentPicker 10 (Comment-mode Escape, `:242,256`).
- `stage.spec.ts`: CommentsState 2, CommentPicker 5. `theme.spec.ts`: CommentsState 9 (banner look). `frameCsp.spec.ts`: hits on "comment" only, no class pattern.
- Evidence only, never gates: `gallery.spec.ts` (9 / 5 / 15), `showcase.spec.ts` (3 / 0 / 3).
- `harness.ts` (1 / 5 / 4): shared locators and helpers (`commentButton`, `pinOf`, `thread`, `openThread`, `popover`, `panelToggle`) used by the specs above; not a guard by itself.

## Candidates

**The plan's question.** Opus: no. Sonnet: partly (no to a merge or facade, yes to narrow fixes). Verdict: **no single comments module.** One class would be about 785 lines with three jobs (requests and panel; anchors, pins and thread; mode, pick and draft), past rule 08's ~300 lines and one job. A facade would still carry `DesignPage`'s 58 pairs (view props, message routing and the `savable` reads): a pass-through. Only 6 of the 66 cross-class pairs run between the three classes (`PinThread` reads 2, `CommentPicker` touches 3 and imports 1); the other 60 are `DesignPage`'s 58 and `EditState`'s 2 (reads `picking`, imports `isTextEntry`), which no merge removes. `CommentPicker` is also Edit mode's picker (`editState.svelte.ts:57`, 9 reads of `picking`). What holds up is narrowing the seams: C1 to C4. The split answer is D2.

### C1. One answer entry on CommentsState [Strong]
- Today: `DesignPage` fans answers to two methods: `ui:error` → `handleActionAnswer` + `handleCopyOpenAnswer` (`DesignPage.svelte:124-125`), `comment:saved` → action only (`:130`), `ui:copied` → both (`:134-135`); methods `commentsState.svelte.ts:189-205`.
- Deletion test: `DesignPage`'s two-call fan-out is a pass-through of a `CommentsState` rule (which answer kinds reach copy-open: `answerCopyOpen` takes `CopiedMessage | UiErrorMessage`, `commentActions.ts:240`). Delete the split and the rule moves to its owner; nothing reappears in `DesignPage`, the only caller.
- Proposal: `comments.handleAnswer(answer: CommentSavedMessage | CopiedMessage | UiErrorMessage)` runs the action step, then the copy-open step unless `answer.type === 'comment:saved'`; the two methods become private. `DesignPage`: `ui:error` → `comments.handleAnswer` (beside `picker.handleCommentAnswer`, `edit.handleEditAnswer`); `comment:saved` and `ui:copied` share one branch. No rule change in `commentActions.ts`. Optional, same file: one private `#send(submitted)` for the "set actions, post if a message" step repeated at `commentsState.svelte.ts:130-133,146-149,159-162`.
- Measured win: `CommentsState` public 23 → 22; cross-class pairs 66 → 65 (call 30 → 29); `DesignPage.svelte` 415 → ~410 lines, wiring 107 → ~104.
- Behavior risk: live-region and "Copied" order stay (action first, then copy-open); one request id matches at most one pending request (`DesignPage.svelte:120-121`). No focus, restore or page-switch move. Guards: `commentsPanel.spec.ts` (Reply, Resolve, Copy, Copy open), `pages.spec.ts`.
- Size: S. Files: `commentsState.svelte.ts`, `DesignPage.svelte`.
- Source: both (Sonnet #1, Opus #2). Sonnet's variant widened `answerCopyOpen`; merged to Opus's type check (Merge log).

### C2. Drop the dead held-draft paths, privatize unused members [Strong]
- Today: `CommentPicker.heldDraft` is public (`commentPicker.svelte.ts:57,114`), cleared at `:173` (`#setMode`), `:217` (`restoreHeldDraft`), `:250` (`#applyPickToDraft`) and `DesignPage.svelte:206` (`handlePinOpen`), read at `DesignPage.svelte:194`. `PinThread.anchors` (`pinThread.svelte.ts:33`) and `flash` (`:42`) are public with no use outside.
- Deletion test: after construction `heldDraft` is always `undefined`. A held draft only comes with a canvas (`pageStart.ts:49-56`; App's `''` start has none, `App.svelte:25-29`; `{#key stage.pageId}` `App.svelte:125` never remounts on the later canvas drop `:64`), and `DesignPage` applies that canvas in its own script (`DesignPage.svelte:217-219` → `:87` → `commentPicker.svelte.ts:217`, which clears it unconditionally). So the clears at `:173`, `:250`, `DesignPage.svelte:206` and the `??` at `:194` never see a value; nothing reappears. The `:55-56` comment ("waits for the first canvas:updated") is stale: App's `draftSlot` does the waiting since 10b (`App.svelte:16,109`).
- Proposal: `#heldDraft` private (plain field); delete the clears at `:173`, `:250`; `savable` uses `draft: picker.savedDraft`; delete `DesignPage`'s `handlePinOpen` wrapper (`:204-208`), Pins gets `onOpen={pinThread.handlePinOpen}`; fix the stale comment; `anchors` and `flash` become `#` fields. Mode, hover, pick and the draft stay in `CommentPicker`; `EditState` still reads `picker.picking` and `isTextEntry`.
- Measured win: `CommentPicker` public 20 → 19; `PinThread` public 20 → 18; pairs 66 → 65, writes 5 → 4; `DesignPage.svelte` 415 → ~409, wiring 107 → ~106 (`:206-207` go, `:347` becomes `onOpen={pinThread.handlePinOpen}`, which matches the pattern).
- Behavior risk: none at runtime (the removed code never runs). Restore guards: `commentPopover.spec.ts` restore tests, `pages.spec.ts:309,339`, `commentsPanel.spec.ts:337,376`.
- Size: S. Files: `commentPicker.svelte.ts`, `pinThread.svelte.ts`, `DesignPage.svelte`.
- Source: both agree on privatizing `heldDraft`, `anchors`, `flash` (Sonnet #2, Opus #1). The dead-path deletion is Opus's alone; Sonnet's proposals assumed the hold is live (Merge log, D3). Tier override, recorded: Strong is kept although the rule asks both reviewers to agree, because the only disagreement is a factual question (is the hold ever set after construction?) that the implementing agent and the 11e1 audit each traced end to end with the citations above, and the deletion moves no runtime behavior.

### C3. One draft-pick entry on PinThread [Worth exploring]
- Today: `CommentPicker.#applyPickToDraft` writes `this.#pinThread.heldThreadId = undefined` (`commentPicker.svelte.ts:251`) and calls `closeThreadImplicitly()` (`:261`); `DesignPage` reads `pinThread.openThreadId ?? pinThread.heldThreadId` (`DesignPage.svelte:195`). Unlike the draft hold, the thread hold is live: `PinThread`'s `$effect.pre` can hold it past mount (`pinThread.svelte.ts:106-130`).
- Deletion test: the outside write vanishes; two pokes become one `PinThread` decision.
- Proposal: `pinThread.handleDraftPick({ userPick: !pick.repost, draftOpen })`, called once after `draftFromPick` (pure, reads no `PinThread`), so `closeThreadImplicitly` still runs before the `requestAnimationFrame` focus (`:266`); `closeThreadImplicitly` private (other use `pinThread.svelte.ts:102`). Optional: a `savedThreadId` getter (like `savedDraft`, `savedReplyDrafts`) so `heldThreadId` goes private. `CommentPicker` keeps mode, hover, pick and the draft; `EditState` still reads `picker.picking` and imports `isTextEntry`.
- Measured win: writes 5 → 4 (3 with C2); pairs 66 → 65; `PinThread` public flat (−2 +2); not an interface shrink.
- Behavior risk: moves restore-hold and implicit-close code. Guards: `pins.spec.ts:512,523`, `commentsPanel.spec.ts:337,376`, `pages.spec.ts:309,339`. **Missing guard:** no browser test checks that a user pick during a held thread cancels the restore (`commentPicker.svelte.ts:249-251`); 11e2 adds it first.
- Size: S. Files: `pinThread.svelte.ts`, `commentPicker.svelte.ts`, `DesignPage.svelte`.
- Source: both (Opus #4; Sonnet #2 as a held-thread release method, Speculative).

### C4. Card callbacks without per-id rebinding [Worth exploring]
- Today: the same per-id binding of `CommentCard` is written twice: `CommentsPanel.svelte:161-170` and `DesignPage.svelte:362,365-373` (incl. the `copied` expression `:371-372`); `CommentsPanel` takes 7 action props only to rebind them.
- Deletion test: a duplicated adapter; remove it and 12 closures vanish from 2 callers.
- Proposal, two variants: (a) Sonnet: `CommentCard` calls `onReplyOpen(comment.id)` etc. and takes `copied: CopiedButton | undefined`; parents pass `comments.handle*` directly. (b) Opus: `comments.cardActions(id)` returns the 9 props (type in `commentActions.ts`); the per-comment handlers and `actions` go private; `CommentsPanel` takes `cardActions`.
- Measured win: (a) no Baseline row moves much (`DesignPage.svelte` ~−1 line, 12 closures gone); (b) `CommentsState` public 23 → ~17, pairs 66 → ~60, `DesignPage.svelte` 415 → ~400, wiring 107 → ~92, `CommentsPanel.svelte` 338 → ~325.
- Behavior risk: no focus or live-region move; `CommentCard` keeps its focus. (b) relies on a spread re-tracking `actions`, `copyFeedback`, `copyBlocked`: confirm with `svelte-autofixer` and the guards. Guards: `commentsPanel.spec.ts`, thread tests in `pins.spec.ts`.
- Size: (a) S, 3 files (`CommentCard.svelte`, `CommentsPanel.svelte`, `DesignPage.svelte`); (b) M, 4 files (`commentsState.svelte.ts`, `commentActions.ts`, `DesignPage.svelte`, `CommentsPanel.svelte`).
- Source: both (Sonnet #4 = (a), Opus #3 = (b)); size disagreement (Sonnet S, Speculative; Opus M, Worth exploring).

### C5. Jump view as a pure rule [Speculative]
- Today: `PinThread.handleJump` (`pinThread.svelte.ts:200-235`) holds guards plus `jumpTarget` → `fitZoom` → `jumpStageView`; `flashOutline` (`:63-79`) repeats the `jumpTarget` call.
- Deletion test: not a pass-through (one caller); rule 08 hygiene only.
- Proposal: `jumpView({ comment, live, frame, view, viewportWidth, viewportHeight })` in `pins.ts`, one test in `pins.test.ts`; `handleJump` becomes find → `jumpView` → `commitStageView` → flash.
- Measured win: `pinThread.svelte.ts` 236 → ~215, `pins.ts` 350 → ~375.
- Behavior risk: keep commit before flash. Guard: `pins.spec.ts` jump tests.
- Size: S. Files: `pinThread.svelte.ts`, `pins.ts`, `pins.test.ts`.
- Source: Sonnet #3.

### C6. Focus predicates in one module [Speculative]
- Today: `canTakeFocus` (`pinThread.svelte.ts:21`) used by `commentPicker.svelte.ts:35,123`; `isTextEntry` (`commentPicker.svelte.ts:43`) used by `editState.svelte.ts:4,314`.
- Deletion test: neither is a pass-through; moving only moves imports.
- Proposal: one small DOM-predicate module for both. `CommentPicker` keeps mode, hover, pick and the draft; `EditState` reads `picker.picking` and imports `isTextEntry` from the new module.
- Measured win: helper imports between class files 2 → 0; +1 file (against rule 03's fewest files).
- Behavior risk: none.
- Size: S. Files: new module, `pinThread.svelte.ts`, `commentPicker.svelte.ts`, `editState.svelte.ts`.
- Source: both (Sonnet #5, Opus #6).

### C7. Rename CommentPicker to its real job [Speculative]
- Today: the class owns Edit mode's mode, hover and pick too (`commentPicker.svelte.ts:47`).
- Deletion test: n/a, naming only.
- Proposal: e.g. `PickState` / `pickState.svelte.ts`; rule 08 catalog and the Method grep names follow. Mode, hover, pick and the draft stay in the renamed class; `EditState` reads its `picking` and imports `isTextEntry` from it.
- Measured win: none; the Map's name mismatch goes.
- Behavior risk: none.
- Size: S. Files: `commentPicker.svelte.ts`, `DesignPage.svelte`, `editState.svelte.ts`, rule 08.
- Source: both (Sonnet #5, Opus #7).

## Disputed

- **D1. Stage focus handle off PinThread.** Opus (Worth exploring): `PinThread.stage` (`pinThread.svelte.ts:41`, bound `DesignPage.svelte:321`) also serves Edit mode's inspector focus (`commentPicker.svelte.ts:150`); move it to `canvas.stage`, or a `DesignPage`-local bind passed as a `focusStage` callback to both constructors; pairs 66 → 64. Sonnet (not proposed): `CanvasState` is read-only context in this review, and it is already 338 lines. Verdict: the `canvas.stage` variant is out of scope as specced; the `focusStage` callback variant stays in scope if Bombic wants it.
- **D2. The plan's question.** Opus: no. Sonnet: partly. Both reject a merge or facade and both back narrow fixes; they differ only in the word. Verdict: no (Candidates intro).
- **D3. Fold the draft restore into `keepLiveState`.** Opus (optional in C2): after C2 the restore is a no-op past the first call, so `applyCanvas` can drop `picker.restoreHeldDraft()` (`DesignPage.svelte:87`) and O2's unstated step goes. Sonnet (not proposed): `handleRenderError` (`DesignPage.svelte:210-214`) calls keep-live without restore, so a render error would resolve the held draft. Verdict: Sonnet's risk cannot occur (the hold is always cleared by the start `applyCanvas`, C2), but the fold moves the restore ahead of `pinThread.keepLiveAnchors` for no Baseline gain beyond one pair; leave it out of C2 unless Bombic picks it.

## Not proposed

- **N1.** One class for all three: ~785 lines, 3 jobs (rule 08); puts Edit mode's pick behind a comments module.
- **N2.** A `Comments` facade for `DesignPage`: it would still carry `DesignPage`'s 58 pairs (view props, message routing and the `savable` reads); views must take props, so it is a pass-through.
- **N3.** Merge `CommentsState` + `PinThread`: ~442 lines, 2 jobs, to delete 2 reads.
- **N4.** Split `CommentPicker` into pick and draft: the draft is driven by `#setMode` (`commentPicker.svelte.ts:167-175`), `keepLiveState` (`:154-163`), `#closeDraft` (`:183-190`), `handlePickMessage` (`:273-285`), `canStep` and `#modeKey` (`:310`); a split adds cross-class writes both ways.
- **N5.** Move `commentItems` or `handleJump` into `CommentsState`: needs `anchors` and the canvas, a dependency cycle or the merge.
- **N6.** A `StageComments.svelte` sibling for `DesignPage.svelte:349-393`: needs the class instances or ~25 props; moves lines, not complexity.
- **N7.** An `$effect` that sends anchors when comments change (removes O3): sync-to-effect timing change for frame messages, no guard.
- **N8.** A shared `RestoredUi` holder for held draft and thread: new class; the ends differ, and the draft hold is dead (C2).
- **N9.** `picker.stepParent` / `stepChild` for the 4 closures at `DesignPage.svelte:289-290,390-391`: naming only.
- **N10.** One answer router across `CommentPicker`, `CommentsState`, `EditState`: different owners; the order-free fan-out is the right join.
- **N11.** Move `savable` into a class: it joins three classes plus `pageId` for App's `PageSavable` (`DesignPage.svelte:7-13,191-197`).
- **N12.** Change the `$effect.pre` hold resolution or construction order O1: moves restore and focus timing (behavior change).

## Merge log

Reviewer numbers are each reviewer's own order (Opus #1-#7, Sonnet #1-#5); the arrow gives the report id.

- Sonnet #1 (→ C1): "widen `answerCopyOpen` to take `comment:saved`, else a stray matching id reads as a copy". Corrected: C1 skips copy-open for `comment:saved` in `CommentsState`, so no rule or test change is needed; same safety.
- Sonnet #2 (→ C2, C3): "add `releaseHeldDraft()`". Corrected: the draft hold is dead after construction (C2 evidence), so the release is deleted, not wrapped.
- Sonnet #2 (→ C3): "the held-draft release in `#setMode` has no matching thread release; do not harmonize". Kept as a note for C3; with C2 the `#setMode` clear goes, which removes the asymmetry without a behavior change.
- Sonnet #4 (→ C4a): "`CommentThread` follows `CommentCard`'s props through `ComponentProps`". Kept (checked, `CommentThread.svelte:12`); variant (a) changes no `CommentThread` code.
- Opus #2 (→ C1): "`DesignPage.svelte:120-121` states the UUID rule". Kept (checked). The Map's first draft cited `:115-116`; corrected to `:120-121` and the fan-out to `:122-127`.
- Opus #3 (→ C4b): "`CommentsState` public 23 → ~17". Kept as an estimate; not measured.
- Opus #5 and Sonnet's not-proposed "move the stage handle into `CanvasState`" (→ D1): both kept as D1.
- Both: "6 of 66 pairs between the three classes". Checked: 2 (`PinThread`) + 3 (`CommentPicker`) + 1 (`canTakeFocus`).
- 11e1 audit (F-01 to F-09): C2's tier override recorded, C1's deletion test reworded, C2's wiring estimate, the `savable` range and the class-member recipe corrected, `harness.ts` classified, the `CommentPicker` line added to C3, C6, C7, these reviewer numbers, and the O1, intro and N2 wording. Re-reviews (F-09 to F-13): the `savable` wording, `editState.svelte.ts:57`; C3's `CommentPicker` line moved into its Proposal; the C2 tier override recorded in the spec.

## Picks

2026-11-27, Bombic (on the implementing agent's recommendation, accepted as given):

- **Picked for 11e2:** C1, C2, C3 (its missing browser guard is written first), C4 variant (a), C5.
- **Not picked:** C4 variant (b), C6, C7, D1, D2, D3.
- **Plan's question answered "no":** `/complete` softens item 11's "comments behind one small interface" wording.

## Re-measure (11e3)

Measured 2026-11-27 on `feature/stage-inspector-helpers` at `fa399a4` (11e2) plus 11e3 Steps 1-4, uncommitted; the 11e3 inputs rows re-checked after the audit fixes F-01 to F-05. Commands: Method, unchanged (11e2 renamed no instance or file). Each figure is `baseline → now`; the comments rows moved in 11e2.

**Size** (measured set, 21 → 21 files):

| Group | Files | Lines |
|---|---|---|
| State classes | `commentsState.svelte.ts` 206 → 209, `pinThread.svelte.ts` 236 → 236, `commentPicker.svelte.ts` 343 → 341 | 785 → 786 |
| Pure rules | `commentActions.ts` 330 → 330, `commentPick.ts` 189 → 189, `commentPopover.ts` 316 → 316, `commentsPanel.ts` 147 → 147, `pins.ts` 350 → 390 | 1,332 → 1,372 |
| Rule tests | `commentActions` 395 → 395, `commentPick` 300 → 300, `commentPopover` 277 → 277, `commentsPanel` 199 → 199, `pins` 431 → 448 | 1,602 → 1,619 |
| Views | `CommentCard` 401 → 404, `CommentPopover` 181 → 181, `CommentThread` 75 → 75, `CommentsPanel` 338 → 338, `Composer` 123 → 123, `PinChip` 42 → 42, `Pins` 167 → 167, `TargetRef` 84 → 84 | 1,411 → 1,414 |
| Total | 21 → 21 files | 5,130 → 5,191 (3,528 → 3,572 without tests) |

**Wiring:**

- `DesignPage.svelte`: 415 → 402 lines; 107 → 102 non-comment lines name a comments class, instance or view.
- Comment-UI save path: 14 → 14 lines in `App.svelte`; `savable` lines 191-197 → 185-191.

**Exports used outside their own file:**

| File | Value used / exported | Type used / exported | Not used outside |
|---|---|---|---|
| 8 views (`default`) | 8 / 8 → 8 / 8 | 0 / 0 → 0 / 0 | none → none |
| `commentActions.ts` | 15 / 15 → 15 / 15 | 4 / 4 → 4 / 4 | none → none |
| `commentPick.ts` | 8 / 8 → 8 / 8 | 6 / 6 → 6 / 6 | none → none |
| `commentPopover.ts` | 13 / 13 → 13 / 13 | 2 / 4 → 2 / 4 | `DraftTarget`, `PopoverKeyAction` → same |
| `commentsPanel.ts` | 8 / 8 → 8 / 8 | 2 / 2 → 2 / 2 | none → none |
| `pins.ts` | 13 / 15 → 14 / 16 (`jumpView`) | 3 / 3 → 3 / 3 | `pinPoint`, `pinLabel` → same |
| `commentsState.svelte.ts` | 1 / 1 → 1 / 1 | 0 / 0 → 0 / 0 | none → none |
| `pinThread.svelte.ts` | 2 / 2 → 2 / 2 | 0 / 0 → 0 / 0 | none → none |
| `commentPicker.svelte.ts` | 2 / 2 → 2 / 2 | 0 / 0 → 0 / 0 | none → none |
| Total | 70 / 72 → 71 / 73 | 17 / 19 → 17 / 19 | 4 → 4 |

**Test-only exports:** 8 → 8 `@internal` in `src/`; 2 → 2 in the measured set (`pinPoint` `pins.ts:162` → `:169`, `pinLabel` `:186` → `:193`).

**Class interfaces** (Method regex: 23 / 20 / 20 → 22 / 18 / 19):

| Class | Public | Used outside its file |
|---|---|---|
| `CommentsState` | 23 → 22 | 23 → 22 |
| `PinThread` | 20 → 18 | 18 → 18 (all) |
| `CommentPicker` | 20 → 19 | 20 → 19 |

**Cross-class uses:** 66 → 63 = write 5 → 3 + read 29 → 29 + call 30 → 29 + helper 2 → 2. By owner: `CommentsState` 23 → 22, `PinThread` 20 → 19, `CommentPicker` 21 → 20, helpers 2 → 2. By reader: `DesignPage` 58 → 56, `PinThread` 2 → 2, `CommentPicker` 4 → 3, `EditState` 2 → 2. Between the three classes: 6 → 5. Hand-read hits, no collision: the writes `picker.heldDraft` and `#pinThread.heldThreadId` are gone; `CommentPicker` calls `handleDraftPick` (`commentPicker.svelte.ts:257`) in place of `closeThreadImplicitly`; `DesignPage` reads `savedThreadId` (`:189`) in place of `heldThreadId` and calls `handleAnswer` (`:124,129`) in place of two answer methods.

**Order constraints in `DesignPage.svelte`** (hand read): 8 → 8 where order matters (O1 `:71-76`, O2 `:84-89`, O3 `:95-96`, O4 `:141-145`, O5 `:141,146-147`, O6 `:205-210`, O7 `:198-202`, O8 `:217-218`); 4 → 3 checked and order-free (the `handlePinOpen` wrapper is gone; the `ui:error` fan-out `:123-125` is 3 calls).

**Repo-wide quality-pass metrics:**

- **Unit:** 75 → 75 files, 926 → 927 tests.
- **Browser** (`--list`, not run): 13 → 13 spec files, 455 → 457 tests: 231 → 233 gating (11e2's held-thread guard, 11e3's pan guard), 220 → 220 gallery, 4 → 4 showcase.
- **`vi.mock(` calls:** 10 → 10 files, 15 → 15 calls, per file unchanged.
- **Files touched per feature:** 10b `f8c842b` 61, 11c4 `b94834f` 13, 11d `374d2ed` 13 (unchanged); 11e2 `fa399a4` 14.

**11e3 inputs:**

| File | Lines | `<script>` lines | `$effect` | Handlers |
|---|---|---|---|---|
| `Stage.svelte` | 636 → 460 | 336 → 160 | 2 → 1 | 6 → 0 |
| `Inspector.svelte` | 507 → 444 | 203 → 140 | 3 → 0 | 0 → 0 |
| `stageGestures.svelte.ts` | new: 234 | n/a (whole file is script; see Lines) | 1 | 3 |
| `inspectorFocus.svelte.ts` | new: 101 | n/a (whole file is script; see Lines) | 3 (one `$effect.pre`) | 0 |

The handler regex `^\s*(const|function) (handle|on)[A-Z]` misses class fields (`handleFrameKeydown`, `handleFrameKeyup`, `handleFrameBlur`, Stage's other 3 of 6) but matches inner `const`s: it prints Stage 0, `stageGestures` 3 (`handleKeydown`, `handleWheel`, `onEmptyStage`), Inspector 0, `inspectorFocus` 0, as expected.

The plan's 11e question (one comments module?) stays answered "no" (Picks); 11e2 and 11e3 do not change it.

Stage `<script>` 336 → 160 lines, `$effect` 2 → 1, handlers 6 → 0 (gesture glue to `StageGestures`, `stageGestures.svelte.ts`: 1 `$effect`, 3 inner handlers, 3 class-field handlers); Inspector `<script>` 203 → 140 lines, `$effect` 3 → 0, handlers 0 → 0 (focus handoff to `InspectorFocus`, `inspectorFocus.svelte.ts`: the 3 effects).
