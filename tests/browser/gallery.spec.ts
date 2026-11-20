import { type Locator, test } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	type Box,
	clickChrome,
	commentButton,
	copyOpenButton,
	panelButton,
	pinOf,
	popover,
	postToChrome,
	zoomSelect,
} from './harness';
import { type VscodeTheme } from './vscodeHost';
import {
	contrastRows,
	type MeasureRequest,
	NON_TEXT_THRESHOLD,
	record,
	sweep,
	sweepFailures,
} from './gallery/contrast';
import {
	captureAt2x,
	jumpChip,
	labelOf,
	lastRequest,
	padded,
	pickElement,
} from './gallery/interact';
import {
	COMMENTS_JSON_ERROR,
	FRAMES,
	type OpenOptions,
	openScene,
	SHORT,
	type StateDefinition,
	withComments,
} from './gallery/scene';
import { bannersStates } from './gallery/states/banners';
import { focusStates } from './gallery/states/focus';
import { inspectorStates } from './gallery/states/inspector';
import { answerError, panelStates } from './gallery/states/panel';
import { pinsStates } from './gallery/states/pins';
import { popoverStates } from './gallery/states/popover';
import { stageStates } from './gallery/states/stage';
import { threadStates } from './gallery/states/thread';
import { toolbarStates } from './gallery/states/toolbar';

// Local evidence, not a gate: every chrome state in both Cursor themes (screenshots + manifest) and
// a WCAG contrast measurement. Skipped unless CD_GALLERY=1; `pnpm gallery` sets it and writes to the
// gitignored test-results/gallery/.

test.skip(process.env.CD_GALLERY !== '1', 'Set CD_GALLERY=1 (pnpm gallery) to run the gallery.');

const OUT = join(__dirname, '..', '..', 'test-results', 'gallery');

const THEMES: readonly VscodeTheme[] = ['dark', 'light'];

type ManifestEntry = {
	id: string;
	surface: string;
	state: string;
	theme: VscodeTheme;
	file: string;
	kind: 'viewport' | 'closeup';
	setup: string;
	notes: string;
};

const manifest: ManifestEntry[] = [];

test.beforeAll(() => {
	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
	writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	writeFileSync(
		join(OUT, 'contrast.json'),
		`${JSON.stringify({ pairs: contrastRows, sweepFailures: [...sweepFailures.values()] }, null, '\t')}\n`,
	);
});

// Shot numbers follow this order.
const states: StateDefinition[] = [
	...toolbarStates,
	...bannersStates,
	...stageStates,
	...popoverStates,
	...pinsStates,
	...threadStates,
	...panelStates,
	...focusStates,
	...inspectorStates,
];

const pad2 = (value: number): string => String(value).padStart(2, '0');

for (const theme of THEMES) {
	test.describe(`${theme} shots`, () => {
		states.forEach((definition, index) => {
			const number = pad2(index + 1);
			test(`${number} ${definition.surface} ${definition.state}`, async ({ page }) => {
				let lastOptions: OpenOptions = {};
				const open = async (options: OpenOptions = {}): Promise<void> => {
					lastOptions = options;
					await openScene({ page, theme, options });
				};
				const shoot = async (options: { closeup?: Box } = {}): Promise<void> => {
					const write = async (kind: ManifestEntry['kind']): Promise<void> => {
						const state = kind === 'closeup' ? `${definition.state}-closeup` : definition.state;
						const id = `${number}-${definition.surface}-${state}-${theme}`;
						const path = join(OUT, `${id}.png`);
						if (kind === 'closeup' && options.closeup !== undefined) {
							await captureAt2x(page, path, padded(options.closeup));
						} else {
							await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
						}
						manifest.push({
							id,
							surface: definition.surface,
							state,
							theme,
							file: `${id}.png`,
							kind,
							setup: definition.setup,
							notes: (definition.notes ?? []).join(' '),
						});
					};
					await sweep(page, theme, `${number}-${definition.surface}-${definition.state}`);
					await write('viewport');
					if (options.closeup !== undefined) {
						await write('closeup');
					}
				};
				await definition.run({
					page,
					open,
					reopen: async (options) => open({ ...lastOptions, ...options }),
					shoot,
				});
			});
		});
	});
}

// Named pairs on the chrome's surfaces; the sweep above catches any text these miss.
const TEXT = 'text' as const;

for (const theme of THEMES) {
	test(`contrast ${theme}`, async ({ page }) => {
		const measure = (
			pair: string,
			request: MeasureRequest,
			extra: { threshold?: number; exempt?: string } = {},
		): Promise<void> => record({ page, theme, pair, request, ...extra });
		const text = (pair: string, selector: string, exempt?: string): Promise<void> =>
			measure(pair, { kind: TEXT, selector }, { exempt });
		const focusRing = async (pair: string, target: Locator, selector: string): Promise<void> => {
			await page.keyboard.press('Tab');
			await target.focus();
			await measure(pair, { kind: 'ring', selector }, { threshold: NON_TEXT_THRESHOLD });
		};
		const open = (options: OpenOptions): Promise<void> => openScene({ page, theme, options });
		const item = (id: string): string => `[data-cd-comment-item="${id}"]`;

		// The kitchen sink: panel with every comment kind, both warning banners, the artboard error, an
		// inline error in a card, and the stale handoff badge.
		await open(withComments({ panel: true }));
		await postToChrome(page, { type: 'ui:status', mcpAvailable: false, handoffStale: true });
		await postToChrome(page, { type: 'artboard:error', message: 'Could not move frame "home".' });
		await clickChrome(panelButton(page, 'h-title', 'Resolve'));
		await answerError(page, 'comment:set-status', 'Could not resolve the comment.');

		await text('body text (card body)', `${item('h-title')} .body`);
		await text('body text (card author)', `${item('h-title')} .author`);
		await text('body text (toolbar artboard id)', '.bar .artboard-id');
		await text('body text (target chip element)', `${item('h-title')} .element`);
		await text('fg-2 text (relative time)', `${item('h-title')} time`);
		await text('fg-2 text (target chip frame)', `${item('h-title')} .frame`);
		await text('fg-2 text (resolved comment body)', `${item('h-f2')} .body`);
		await text('fg-2 text (panel summary)', 'aside .summary');
		await text('fg-2 text (panel group heading)', 'aside .section-title');
		await text('fg-2 text (toolbar generation)', '.bar .generation');
		await text('fg-2 text (frame size)', '.label-size');
		await text('fg-2 text (stage group heading)', '.heading');
		await text('badge label (open status)', `${item('h-title')} .head .badge`);
		await text('badge label (sent status)', `${item('h-sub')} .head .badge`);
		await text('badge label (resolved status)', `${item('h-f2')} .head .badge`);
		await text('badge label (stale flag)', `${item('h-nav')} .flags .badge`);
		await text('badge label (missing flag)', `${item('h-old')} .flags .badge`);
		await text('badge label (unchecked flag)', `${item('h-art')} .flags .badge`);
		await text('badge label (handoff warning)', '.bar .badge');
		await text('badge label (toolbar count)', '.icon-button .count');
		await text('message text (inline error)', `${item('h-title')} .message.tone-error .text`);
		await text('message text (banner error)', '.message.variant-banner.tone-error .text');
		await text('message text (banner warning)', '.message.variant-banner.tone-warning .text');
		await text('button label (primary)', '[data-cd-copy-open]');
		await text('button label (ghost)', `${item('h-title')} [data-cd-focus="reply"]`);
		await text('button label (ghost agent)', `${item('h-title')} [data-cd-focus="copy"]`);
		await text('button label (segment, pressed)', '.mode [aria-pressed="true"]');
		await text('button label (segment, unpressed)', '.mode [aria-pressed="false"]');
		await text('select text (zoom)', '.zoom select');
		await text('pin number on open pin', '[data-cd-pin="h-title"]');
		await text('pin number on sent pin', '[data-cd-pin="h-sub"]');
		await text('pin number on resolved pin', '[data-cd-pin="h-f2"]');
		await text('pin number on missing pin', '[data-cd-pin="h-old"]');
		await text('pin chip number (open)', `${item('h-title')} .pin-chip`);
		await text('pin chip number (sent)', `${item('h-sub')} .pin-chip`);
		await text('pin chip number (resolved)', `${item('h-f2')} .pin-chip`);

		// Focus rings: outside rings against the parent's fill, the inset field ring against its own.
		await focusRing(
			'focus ring (segment on the mode group)',
			commentButton(page),
			'.mode [aria-keyshortcuts]',
		);
		await focusRing(
			'focus ring (toolbar icon button)',
			page.getByRole('button', { name: 'Fit all' }),
			'.bar button[aria-label="Fit all"]',
		);
		await focusRing('focus ring (zoom select)', zoomSelect(page), '.zoom select');
		await focusRing(
			'focus ring (ghost button on a card)',
			panelButton(page, 'h-sub', 'Resolve'),
			`${item('h-sub')} [data-cd-focus="status"]`,
		);
		await focusRing(
			'focus ring (primary button on the panel)',
			copyOpenButton(page),
			'[data-cd-copy-open]',
		);
		await focusRing(
			'focus ring (target chip)',
			jumpChip(page, 'h-cta'),
			`${item('h-cta')} [data-cd-focus="jump"]`,
		);
		await focusRing(
			'focus ring (frame label on the stage)',
			labelOf(page, 'pricing'),
			'[data-cd-frame-label="pricing"]',
		);
		// The pin ring touches the pin's halo (offset 2px), so it is measured against both.
		await focusRing(
			'focus ring (pin) on the stage',
			pinOf(page, 'h-title'),
			'[data-cd-pin="h-title"]',
		);
		await measure(
			'focus ring (pin) against its halo',
			{ kind: 'tokens', foreground: '--cd-focus', background: '--cd-pin-ring' },
			{ threshold: NON_TEXT_THRESHOLD },
		);

		// Pin fills against their ring (the editor background).
		for (const [pair, foreground] of [
			['pin fill (open) against its ring', '--cd-open'],
			['pin fill (sent) against its ring', '--cd-agent'],
			['pin fill (resolved) against its ring', '--cd-pin-resolved-bg'],
		] as const) {
			await measure(
				pair,
				{ kind: 'tokens', foreground, background: '--cd-pin-ring' },
				{ threshold: NON_TEXT_THRESHOLD },
			);
		}

		// Exempt, listed: --cd-fg-3 is non-text only; disabled text is exempt from 1.4.3.
		for (const [pair, background] of [
			['fg-3 on the chrome', '--cd-bg-chrome'],
			['fg-3 on the stage', '--cd-bg-stage'],
			['fg-3 on a card', '--cd-bg-card'],
		] as const) {
			await measure(
				pair,
				{ kind: 'tokens', foreground: '--cd-fg-3', background },
				{
					threshold: NON_TEXT_THRESHOLD,
					exempt: 'non-text only (icons, dividers, the resize bar)',
				},
			);
		}

		// The Copied state is the secondary button.
		await clickChrome(copyOpenButton(page));
		const copyRequest = await lastRequest(page, 'comment:copy-open');
		await postToChrome(page, {
			type: 'ui:copied',
			requestId: String(copyRequest.requestId),
			count: 9,
		});
		await text('button label (secondary)', '[data-cd-copy-open]');

		await open({
			definitions: SHORT.filter((definition) => definition.status === 'resolved'),
			panel: true,
		});
		await text(
			'disabled text (copy-open, nothing to send)',
			'[data-cd-copy-open]',
			'disabled text (WCAG 1.4.3)',
		);

		// The comments.json banner (a warning) and the empty-panel state text.
		await open({ definitions: [], panel: true });
		await postToChrome(page, {
			type: 'comments:updated',
			comments: [],
			error: COMMENTS_JSON_ERROR,
		});
		await text('message text (banner warning, comments.json)', '[data-cd-comments-error] .text');
		await text('fg-2 text (panel empty-state body)', 'aside .empty-state');

		// The popover: a typed draft, the host's error, and the blocked-target info message.
		await open({});
		await pickElement(page, 'home', '#hero-title');
		await measure('placeholder text (comment box)', {
			kind: 'placeholder',
			selector: '[data-cd-comment-popover] textarea',
		});
		await page.keyboard.type('Tighten this copy.');
		await text('input text (comment box)', '[data-cd-comment-popover] textarea');
		await text('button label (primary, popover)', '[data-cd-comment-popover] .variant-primary');
		await text('fg-2 text (popover keyboard hint)', '[data-cd-comment-popover] .hint');
		await text('body text (kbd)', '[data-cd-comment-popover] kbd');
		await focusRing(
			'focus ring (inset, comment box)',
			popover(page).getByRole('textbox', { name: 'Comment' }),
			'[data-cd-comment-popover] textarea',
		);
		await page.keyboard.press('Enter');
		const createRequest = await lastRequest(page, 'comment:create');
		await postToChrome(page, {
			type: 'ui:error',
			message: 'Could not save the comment. Fix .cursor-design/comments.json and try again.',
			requestId: String(createRequest.requestId),
		});
		await text(
			'message text (inline error, popover)',
			'[data-cd-comment-popover] .message.tone-error .text',
		);
		await open({
			frames: FRAMES.map((frame) => (frame.id === 'home' ? { ...frame, generation: 0 } : frame)),
		});
		await pickElement(page, 'home', '#hero-title');
		await page.keyboard.type('Why is Add disabled?');
		await text(
			'message text (inline info, popover)',
			'[data-cd-comment-popover] .message.tone-info .text',
		);

		await open({ noCanvas: true });
		await text(
			'disabled text (segment, no artboard)',
			'.mode button',
			'disabled text (WCAG 1.4.3)',
		);
	});
}
