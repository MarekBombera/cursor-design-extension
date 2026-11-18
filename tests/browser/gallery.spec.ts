import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type CDPSession, expect, type Locator, type Page, test } from '@playwright/test';

import { FRAME_ANCHOR_RECTS_MESSAGE } from '../../src/webview/frame/frameMessages';
import type { PostedCanvasFrame, PostedComment } from '../../src/webview/hostMessages';
import {
	type Box,
	boxOf,
	canvasUpdated,
	clickAt,
	clickChrome,
	commentButton,
	copyOpenButton,
	frameBox,
	frameOf,
	isMessageOfType,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	panel,
	panelButton,
	panelItem,
	panelToggle,
	pinOf,
	popover,
	posted,
	postToChrome,
	stageBox,
	thread,
	threadButton,
	untilHeightReported,
	zoomSelect,
} from './harness';
import type { VscodeTheme } from './vscodeHost';

// Local evidence, not a gate: every chrome state in both Cursor themes (screenshots + manifest) and
// a WCAG contrast measurement. Skipped unless CD_GALLERY=1; `pnpm gallery` sets it and writes to the
// gitignored test-results/gallery/.

test.skip(process.env.CD_GALLERY !== '1', 'Set CD_GALLERY=1 (pnpm gallery) to run the gallery.');

const OUT = join(__dirname, '..', '..', 'test-results', 'gallery');
const ARTBOARDS = join(__dirname, '..', '..', 'fixtures', 'gallery');

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

type ContrastRow = {
	pair: string;
	theme: VscodeTheme;
	foreground: string;
	background: string;
	ratio: number;
	threshold: number;
	pass: boolean;
	// Set for pairs that are listed but never fail (non-text, disabled).
	exempt?: string;
};

const manifest: ManifestEntry[] = [];
const contrastRows: ContrastRow[] = [];
const sweepFailures = new Map<string, ContrastRow>();

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

const artboard = (name: string): string => readFileSync(join(ARTBOARDS, `${name}.html`), 'utf8');
const HOME_HTML = artboard('home');
const MOBILE_HTML = artboard('mobile');

const FRAMES: PostedCanvasFrame[] = [
	{
		id: 'home',
		label: 'Home',
		x: 0,
		y: 0,
		width: 480,
		group: 'Web',
		generation: 3,
		html: HOME_HTML,
	},
	{
		id: 'pricing',
		label: 'Pricing',
		x: 504,
		y: 0,
		width: 420,
		group: 'Web',
		generation: 2,
		html: artboard('pricing'),
	},
	{
		id: 'mobile',
		label: 'Mobile',
		x: 948,
		y: 0,
		width: 320,
		group: 'Mobile',
		generation: 1,
		html: MOBILE_HTML,
	},
];
const IFRAME_IDS = ['home', 'pricing', 'mobile'];
const VIEW = { x: 6, y: 76, zoom: 1 };

type View = { x: number; y: number; zoom: number };
type Definition = Partial<PostedComment> &
	Pick<PostedComment, 'id' | 'frameId' | 'selector' | 'tagName' | 'text' | 'body'>;

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

// The target's rect comes from the live frame, so pins land on real elements.
const buildComment = async (page: Page, definition: Definition): Promise<PostedComment> => {
	let rect = definition.rect;
	if (rect === undefined) {
		rect =
			definition.isPage === true
				? null
				: await (
						await frameOf(page, definition.frameId)
					).evaluate((selector) => {
						const element = document.querySelector(selector);
						if (element === null) {
							throw new Error(`No element for ${selector}`);
						}
						const { x, y, width, height } = element.getBoundingClientRect();
						return { x, y, width, height };
					}, definition.selector);
	}
	return {
		pin: { x: 0.5, y: 0.5 },
		isPage: false,
		status: 'open',
		createdAt: ago(18),
		replies: [],
		stale: false,
		targetMissing: false,
		...definition,
		rect,
	};
};

const SHORT: Definition[] = [
	{
		id: 'h-title',
		frameId: 'home',
		selector: '#hero-title',
		tagName: 'h1',
		text: 'Ship designs your whole team can review',
		body: 'The headline wraps to three lines at this width. Can we tighten it?',
		pin: { x: 0.3, y: 0.5 },
		createdAt: ago(18),
	},
	{
		id: 'h-sub',
		frameId: 'home',
		selector: '#hero-sub',
		tagName: 'p',
		text: 'Lumen turns every artboard into a shared canvas with comments, versions and handoff',
		body: 'Too long for the hero. Two lines max, please.',
		status: 'sent',
		pin: { x: 0.6, y: 0.4 },
		createdAt: ago(95),
		replies: [
			{
				id: 'r1',
				author: 'user',
				body: 'Also check the line length on the mobile frame.',
				createdAt: ago(80),
			},
			{
				id: 'r2',
				author: 'agent',
				body: 'Shortened the copy to two lines and capped the width at 34ch. Version 4 is saved; the mobile frame is next.',
				createdAt: ago(41),
			},
		],
	},
	{
		id: 'h-cta',
		frameId: 'home',
		selector: '#cta-primary',
		tagName: 'button',
		text: 'Create a board',
		body: 'Contrast of white on this lavender is low. Use the darker indigo from the pricing page.',
		pin: { x: 0.85, y: 0.5 },
		createdAt: ago(7),
	},
	{
		id: 'h-f2',
		frameId: 'home',
		selector: '#feature-2',
		tagName: 'article',
		text: 'Versions Every change is a version you can compare and restore.',
		body: 'The icon sits 4px lower than in the other two cards.',
		status: 'resolved',
		pin: { x: 0.2, y: 0.25 },
		createdAt: ago(60 * 26),
		replies: [
			{
				id: 'r3',
				author: 'agent',
				body: 'Fixed: aligned the icon to the card padding.',
				createdAt: ago(60 * 25),
			},
		],
	},
	{
		id: 'h-old',
		frameId: 'home',
		selector: '#promo-banner',
		tagName: 'div',
		text: 'Early access: 50% off',
		body: 'Is this banner meant to be removed? I still see it in the mock.',
		rect: { x: 0, y: 60, width: 480, height: 36 },
		targetMissing: true,
		pin: { x: 0.5, y: 0.5 },
		createdAt: ago(60 * 5),
	},
	{
		id: 'h-nav',
		frameId: 'home',
		selector: '#nav-cta',
		tagName: 'button',
		text: 'Sign in',
		body: 'Should this say "Log in" to match the app?',
		stale: true,
		pin: { x: 0.5, y: 0.5 },
		createdAt: ago(3),
	},
	{
		id: 'h-art',
		frameId: 'home',
		selector: '#hero-art',
		tagName: 'div',
		text: '',
		body: 'Replace this gradient with a product screenshot.',
		stale: null,
		targetMissing: null,
		pin: { x: 0.35, y: 0.6 },
		createdAt: ago(1),
	},
	{
		id: 'h-page',
		frameId: 'home',
		selector: 'body',
		tagName: 'body',
		text: '',
		body: 'Spacing between sections is inconsistent across the whole frame.',
		isPage: true,
		pin: { x: 0.93, y: 0.3 },
		createdAt: ago(60 * 24 * 3),
	},
	{
		id: 'p-price',
		frameId: 'pricing',
		selector: '#pro-price',
		tagName: 'div',
		text: '$12 /editor /mo',
		body: 'Show the yearly price here when the toggle is on.',
		pin: { x: 0.5, y: 0.5 },
		createdAt: ago(12),
	},
	{
		id: 'p-team',
		frameId: 'pricing',
		selector: '#plan-team',
		tagName: 'section',
		text: 'Team $24 /editor /mo Shared libraries SSO Priority support Contact sales',
		body: 'The Team card is missing the "Most flexible" tag from the brief. Also, the button label should be "Talk to sales" and it should open the contact form, not a mailto link, and we need to decide what happens for orgs under 5 seats.',
		pin: { x: 0.8, y: 0.15 },
		createdAt: ago(240),
	},
	{
		id: 'm-cta',
		frameId: 'mobile',
		selector: '#m-cta',
		tagName: 'button',
		text: 'Create a board',
		body: 'The button is 14px from the edge; our minimum is 16px.',
		pin: { x: 0.9, y: 0.5 },
		createdAt: ago(33),
	},
];

const SENTENCES = [
	'This spacing feels off compared with the pricing page; the vertical rhythm there is 24px and here it is closer to 18px.',
	'Can we try the darker indigo here? The current color fails contrast against the gradient behind it on most displays.',
	'Please confirm the copy with marketing before we ship, the legal team flagged "shared canvas" last week.',
	'The tap target is smaller than 44px on mobile.',
	'Align the baseline of this label with the heading next to it, they drift by a pixel at some zoom levels.',
	'I like the direction. Could the card also show who last edited it, and when?',
];
const LONG_SELECTOR =
	'main#content > section.features > div.grid > article.card:nth-of-type(3) > div.card-body > p.card-copy > span.highlight#deep-target';
const LONG_TEXT =
	'Export specs with tokens and measurements included, plus a very long trailing sentence that keeps going to test ellipsis';

const longList = (): Definition[] => {
	const targets: Pick<Definition, 'frameId' | 'selector' | 'tagName' | 'text'>[] = [
		{
			frameId: 'home',
			selector: '#hero-title',
			tagName: 'h1',
			text: 'Ship designs your whole team can review',
		},
		{ frameId: 'home', selector: '#cta-primary', tagName: 'button', text: 'Create a board' },
		{ frameId: 'home', selector: '#deep-target', tagName: 'span', text: LONG_TEXT },
		{ frameId: 'pricing', selector: '#pro-cta', tagName: 'button', text: 'Start 14-day trial' },
		{
			frameId: 'pricing',
			selector: '#plan-free',
			tagName: 'section',
			text: 'Free $0 /editor 3 boards Comments Get started',
		},
		{
			frameId: 'mobile',
			selector: '#m-hero-title',
			tagName: 'h1',
			text: 'Review designs where they live',
		},
		{ frameId: 'mobile', selector: '#m-fab', tagName: 'button', text: '+' },
	];
	return Array.from({ length: 26 }, (_, index) => {
		const target = targets[index % targets.length] as (typeof targets)[number];
		const body = Array.from(
			{ length: 1 + (index % 4) },
			(__, offset) => SENTENCES[(index + offset) % SENTENCES.length],
		).join(' ');
		const status = index % 7 === 3 ? 'resolved' : index % 5 === 1 ? 'sent' : 'open';
		return {
			id: `l-${String(index).padStart(2, '0')}`,
			...target,
			selector: target.selector === '#deep-target' ? LONG_SELECTOR : target.selector,
			body:
				index === 4
					? `${body} ${'averyveryveryverylongunbrokenwordwithoutspaces'.repeat(3)}`
					: body,
			status,
			pin: { x: 0.1 + ((index * 0.13) % 0.8), y: 0.2 + ((index * 0.29) % 0.6) },
			createdAt: ago(5 + index * 47),
			replies:
				index % 3 === 0
					? [
							{
								id: `lr-${index}`,
								author: 'agent',
								body: 'Updated in version 5. The change touches the shared token, so the other frames moved too.',
								createdAt: ago(2 + index * 20),
							},
						]
					: [],
		};
	});
};

// One self-contained function (Playwright serialises it into the page). Colours are composited the
// way they paint: a semi-transparent text colour over the element's actual background (every
// ancestor fill up to the first opaque one), and a ring over its neighbour's.
type MeasureRequest =
	| { kind: 'text'; selector: string }
	| { kind: 'placeholder'; selector: string }
	| { kind: 'ring'; selector: string }
	| { kind: 'tokens'; foreground: string; background: string }
	| { kind: 'sweep' };

type Measured = { label: string; foreground: string; background: string; ratio: number };

const measureInPage = (request: MeasureRequest): Measured[] => {
	type Rgba = { r: number; g: number; b: number; a: number };
	const channel = (token: string): number =>
		token.endsWith('%') ? Number.parseFloat(token) / 100 : Number(token);
	const parse = (value: string): Rgba => {
		const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
		if (rgb !== null) {
			const parts = (rgb[1] ?? '').split(/[\s,/]+/).filter(Boolean);
			return {
				r: Number(parts[0]),
				g: Number(parts[1]),
				b: Number(parts[2]),
				a: parts[3] === undefined ? 1 : channel(parts[3]),
			};
		}
		const srgb = /^color\(srgb ([^)]+)\)$/.exec(value);
		if (srgb !== null) {
			const parts = (srgb[1] ?? '').split(/[\s/]+/).filter(Boolean);
			return {
				r: Number(parts[0]) * 255,
				g: Number(parts[1]) * 255,
				b: Number(parts[2]) * 255,
				a: parts[3] === undefined ? 1 : channel(parts[3]),
			};
		}
		throw new Error(`Unparsed colour: ${value}`);
	};
	const over = (top: Rgba, bottom: Rgba): Rgba => ({
		r: top.r * top.a + bottom.r * (1 - top.a),
		g: top.g * top.a + bottom.g * (1 - top.a),
		b: top.b * top.a + bottom.b * (1 - top.a),
		a: 1,
	});
	const luminance = (color: Rgba): number => {
		const linear = (value: number): number => {
			const scaled = value / 255;
			return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
	};
	const hex = (color: Rgba): string =>
		`#${[color.r, color.g, color.b]
			.map((value) => Math.round(value).toString(16).padStart(2, '0'))
			.join('')}`;
	const fillBehind = (start: Element | null): Rgba => {
		const fills: Rgba[] = [];
		for (let node = start; node !== null; node = node.parentElement) {
			const fill = parse(getComputedStyle(node).backgroundColor);
			if (fill.a > 0) {
				fills.push(fill);
				if (fill.a >= 0.999) {
					break;
				}
			}
		}
		let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
		for (const fill of [...fills].reverse()) {
			base = over(fill, base);
		}
		return base;
	};
	const opacityOf = (element: Element): number => {
		let opacity = 1;
		for (let node: Element | null = element; node !== null; node = node.parentElement) {
			opacity *= Number(getComputedStyle(node).opacity);
		}
		return opacity;
	};
	const resolveToken = (token: string): Rgba => {
		const probe = document.createElement('span');
		probe.style.color = `var(${token})`;
		document.body.append(probe);
		const color = parse(getComputedStyle(probe).color);
		probe.remove();
		return color;
	};
	const measured = (label: string, foreground: Rgba, background: Rgba): Measured => {
		const effective = over(foreground, background);
		const lighter = Math.max(luminance(effective), luminance(background));
		const darker = Math.min(luminance(effective), luminance(background));
		return {
			label,
			foreground: hex(effective),
			background: hex(background),
			ratio: (lighter + 0.05) / (darker + 0.05),
		};
	};
	const textOf = (element: Element, color: string): Measured => {
		const foreground = parse(color);
		foreground.a *= opacityOf(element);
		return measured(element.tagName.toLowerCase(), foreground, fillBehind(element));
	};

	if (request.kind === 'tokens') {
		return [
			measured(
				request.foreground,
				resolveToken(request.foreground),
				over(resolveToken(request.background), { r: 255, g: 255, b: 255, a: 1 }),
			),
		];
	}
	if (request.kind === 'sweep') {
		const rows: Measured[] = [];
		for (const element of document.querySelectorAll('#svelte-root *')) {
			const hasText = Array.from(element.childNodes).some(
				(node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
			);
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			if (
				!hasText ||
				rect.width === 0 ||
				rect.height === 0 ||
				style.visibility === 'hidden' ||
				element.closest('[hidden], .visually-hidden') !== null
			) {
				continue;
			}
			const row = textOf(element, style.color);
			// The toolbar's C hint is muted with the mode buttons it belongs to (Toolbar's kbd.muted),
			// so it counts as their inactive text.
			const disabled =
				element.closest(':disabled, [aria-disabled="true"]') !== null ||
				element.matches('.bar kbd.muted');
			const text = (element.textContent ?? '').trim().slice(0, 40);
			rows.push({
				...row,
				label: `${row.label}.${String(element.className).split(' ')[0] ?? ''} "${text}"${disabled ? ' [disabled]' : ''}`,
			});
		}
		return rows;
	}
	const element = document.querySelector(request.selector);
	if (element === null) {
		throw new Error(`No element matches ${request.selector}`);
	}
	if (request.kind === 'text') {
		return [{ ...textOf(element, getComputedStyle(element).color), label: request.selector }];
	}
	if (request.kind === 'placeholder') {
		return [
			{
				...textOf(element, getComputedStyle(element, '::placeholder').color),
				label: request.selector,
			},
		];
	}
	// ring: a ring outside the element (offset >= 0) sits on the parent's fill; an inset one on its own.
	const style = getComputedStyle(element);
	if (style.outlineStyle === 'none' || !element.matches(':focus-visible')) {
		throw new Error(`${request.selector} shows no focus ring.`);
	}
	const inset = Number.parseFloat(style.outlineOffset) < 0;
	return [
		{
			...measured(
				request.selector,
				parse(style.outlineColor),
				fillBehind(inset ? element : element.parentElement),
			),
			label: request.selector,
		},
	];
};

const SWEEP: MeasureRequest = { kind: 'sweep' };
const TEXT_THRESHOLD = 4.5;
const NON_TEXT_THRESHOLD = 3;

const record = async ({
	page,
	theme,
	pair,
	request,
	threshold = TEXT_THRESHOLD,
	exempt,
}: {
	page: Page;
	theme: VscodeTheme;
	pair: string;
	request: MeasureRequest;
	threshold?: number;
	exempt?: string;
}): Promise<void> => {
	const [row] = await page.evaluate(measureInPage, request);
	if (row === undefined) {
		throw new Error(`Nothing measured for ${pair}.`);
	}
	const ratio = Math.round(row.ratio * 100) / 100;
	contrastRows.push({
		pair,
		theme,
		foreground: row.foreground,
		background: row.background,
		ratio,
		threshold,
		pass: ratio >= threshold,
		...(exempt === undefined ? {} : { exempt }),
	});
};

// Every visible text node of the shot, so a pair the named probes miss still shows up. Only
// failures are kept (one row per theme, element and text); disabled text is exempt.
const sweep = async (page: Page, theme: VscodeTheme, shot: string): Promise<void> => {
	for (const row of await page.evaluate(measureInPage, SWEEP)) {
		const ratio = Math.round(row.ratio * 100) / 100;
		if (ratio >= TEXT_THRESHOLD) {
			continue;
		}
		const disabled = row.label.endsWith('[disabled]');
		sweepFailures.set(`${theme} ${row.label}`, {
			pair: `${row.label} (first seen in ${shot})`,
			theme,
			foreground: row.foreground,
			background: row.background,
			ratio,
			threshold: TEXT_THRESHOLD,
			pass: false,
			...(disabled ? { exempt: 'disabled text (WCAG 1.4.3)' } : {}),
		});
	}
};

type OpenOptions = {
	frames?: PostedCanvasFrame[];
	view?: View;
	definitions?: Definition[];
	panel?: boolean;
	noCanvas?: boolean;
};

type Session = {
	page: Page;
	open: (options?: OpenOptions) => Promise<void>;
	reopen: (options: OpenOptions) => Promise<void>;
	shoot: (options?: { closeup?: Box }) => Promise<void>;
};

type StateDefinition = {
	surface: string;
	state: string;
	setup: string;
	notes?: string[];
	run: (session: Session) => Promise<void>;
};

// A frame of animation plus the longest transition (120ms), so the shot is at rest.
const settle = async (page: Page): Promise<void> => {
	await nextAnimationFrame(page);
	await page.waitForTimeout(220);
	await nextAnimationFrame(page);
};

const cdpSessions = new WeakMap<Page, CDPSession>();

// A 2x clip through CDP (clip.scale re-rasterises, so text is crisp). The clip is in document
// coordinates and the root is the stage's scroll sink, so its offset is added.
const captureAt2x = async (page: Page, path: string, clip: Box): Promise<void> => {
	let session = cdpSessions.get(page);
	if (session === undefined) {
		session = await page.context().newCDPSession(page);
		cdpSessions.set(page, session);
	}
	const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
	await page.addStyleTag({ content: '* { caret-color: transparent !important; }' });
	const { data } = await session.send('Page.captureScreenshot', {
		format: 'png',
		clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y, scale: 2 },
		captureBeyondViewport: false,
	});
	writeFileSync(path, Buffer.from(data, 'base64'));
};

const padded = (box: Box, margin = 24): Box => {
	const x = Math.max(0, Math.floor(box.x - margin));
	const y = Math.max(0, Math.floor(box.y - margin));
	const right = Math.min(1280, Math.ceil(box.x + box.width + margin));
	const bottom = Math.min(800, Math.ceil(box.y + box.height + margin));
	return { x, y, width: right - x, height: bottom - y };
};

const unionOf = (boxes: Box[]): Box => {
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.width));
	const bottom = Math.max(...boxes.map((box) => box.y + box.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
};

const toolbar = (page: Page): Locator => page.getByRole('banner');
const jumpChip = (page: Page, id: string): Locator =>
	panelItem(page, id).locator('[data-cd-focus="jump"]');
const labelOf = (page: Page, id: string): Locator => page.locator(`[data-cd-frame-label="${id}"]`);
const handleOf = (page: Page, id: string): Locator =>
	page.locator(`[data-cd-frame-resize="${id}"]`);

const lastRequest = async (page: Page, type: string): Promise<Record<string, unknown>> => {
	const ofType = async (): Promise<Record<string, unknown>[]> =>
		(await posted(page)).filter((message): message is Record<string, unknown> =>
			isMessageOfType(message, type),
		);
	await expect.poll(async () => (await ofType()).length).toBeGreaterThan(0);
	return (await ofType()).at(-1) as Record<string, unknown>;
};

const pointIn = async ({
	page,
	frameId,
	selector,
	zoom = 1,
	fx = 0.5,
	fy = 0.5,
}: {
	page: Page;
	frameId: string;
	selector: string;
	zoom?: number;
	fx?: number;
	fy?: number;
}): Promise<{ x: number; y: number }> => {
	const frame = await frameBox(page, frameId);
	const rect = await (
		await frameOf(page, frameId)
	).evaluate((wanted) => {
		const element = document.querySelector(wanted);
		if (element === null) {
			throw new Error(`No element matches ${wanted}.`);
		}
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height };
	}, selector);
	return {
		x: frame.x + (rect.x + rect.width * fx) * zoom,
		y: frame.y + (rect.y + rect.height * fy) * zoom,
	};
};

const hoverOver = async (page: Page, point: { x: number; y: number }, from = 20): Promise<void> => {
	await page.mouse.move(point.x - from, point.y, { steps: 5 });
	await page.mouse.move(point.x, point.y, { steps: 5 });
	await page.waitForTimeout(250);
};

const pickElement = async (page: Page, frameId: string, selector: string): Promise<void> => {
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	const point = await pointIn({ page, frameId, selector });
	await page.mouse.move(point.x, point.y, { steps: 4 });
	await page.mouse.move(point.x + 0.5, point.y + 0.5);
	await page.waitForTimeout(120);
	await clickAt(page, point);
	await expect(popover(page)).toBeVisible();
	// Typing before the box has focus goes nowhere.
	await expect(popover(page).getByRole('textbox', { name: 'Comment' })).toBeFocused();
};

const openThread = async (page: Page, id: string): Promise<void> => {
	await expect(pinOf(page, id)).toBeVisible();
	// Near the tip, the part on its target's corner: a target at the frame's left edge puts the
	// pin's body off the stage edge at the gallery view (F-108).
	const pin = await boxOf(pinOf(page, id));
	await clickAt(page, { x: pin.x + pin.width - 4, y: pin.y + pin.height - 4 });
	await expect(thread(page)).toBeVisible();
	await settle(page);
};

const openPanelUi = async (page: Page): Promise<void> => {
	await clickChrome(panelToggle(page));
	await expect(panel(page)).toBeVisible();
	await settle(page);
};

const frameGesture = async ({
	page,
	label,
	dx,
	dy,
	release,
}: {
	page: Page;
	label: Locator;
	dx: number;
	dy: number;
	release: boolean;
}): Promise<void> => {
	const box = await boxOf(label);
	await page.mouse.move(box.x + 10, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 10 + dx, box.y + box.height / 2 + dy, { steps: 10 });
	if (release) {
		await page.mouse.up();
	}
};

const states: StateDefinition[] = [];
const add = (definition: StateDefinition): void => {
	states.push(definition);
};

const withComments = (extra: Partial<OpenOptions> = {}): OpenOptions => ({
	definitions: SHORT,
	...extra,
});

const MCP_DOWN = { type: 'ui:status', mcpAvailable: false, handoffStale: false } as const;
const HANDOFF_STALE = { type: 'ui:status', mcpAvailable: true, handoffStale: true } as const;
const COMMENTS_JSON_ERROR =
	'comments.json is not valid. Fix or delete .cursor-design/comments.json.';

// 1. Toolbar
const toolbarState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
	notes?: string[],
): void => {
	add({ surface: 'toolbar', state, setup, notes, run });
};
toolbarState(
	'default',
	'Three frames at 100%, 11 comments (10 unresolved: 9 open + 1 sent), panel closed, Interact mode.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
toolbarState('comment-mode', 'Clicked the Comment segment.', async ({ open, shoot, page }) => {
	await open(withComments());
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await page.mouse.move(640, 20);
	await settle(page);
	await shoot({ closeup: await boxOf(toolbar(page)) });
});
toolbarState(
	'zoom-select-focused',
	'Tabbed, then focused the Zoom select (the native popup is not captured by headless screenshots).',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await page.keyboard.press('Tab');
		await zoomSelect(page).focus();
		await settle(page);
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
	['The native <select> popup list is drawn by the OS and is absent from the screenshot.'],
);
toolbarState('zoom-75-readout', 'Chose 75% in the Zoom select.', async ({ open, shoot, page }) => {
	await open(withComments());
	await zoomSelect(page).selectOption('0.75');
	await settle(page);
	await shoot({ closeup: await boxOf(toolbar(page)) });
});
toolbarState(
	'panel-open-count',
	'Clicked Comments to open the panel; the button shows its pressed style and the count.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await openPanelUi(page);
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
toolbarState(
	'handoff-stale',
	'Host message ui:status { mcpAvailable: true, handoffStale: true }.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, HANDOFF_STALE);
		await settle(page);
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
toolbarState(
	'no-artboard-disabled',
	'No canvas:updated: the mode segments, zoom select and Fit all are disabled; Comments stays enabled.',
	async ({ open, shoot, page }) => {
		await open({ noCanvas: true });
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);

// 2. Banners
const bannerState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
	notes?: string[],
): void => {
	add({ surface: 'banner', state, setup, notes, run });
};
bannerState(
	'mcp-unavailable',
	'ui:status { mcpAvailable: false }.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, MCP_DOWN);
		await settle(page);
		await shoot();
	},
);
bannerState(
	'handoff-stale',
	'ui:status { handoffStale: true }: the marker is a toolbar badge, not a banner.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, HANDOFF_STALE);
		await settle(page);
		await shoot();
	},
);
bannerState(
	'artboard-error',
	'artboard:error with a file-read message.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, {
			type: 'artboard:error',
			message: 'Could not read .cursor-design/artboards/home.html: file is not valid UTF-8.',
		});
		await settle(page);
		await shoot();
	},
);
bannerState(
	'comments-error',
	`comments:updated with error "${COMMENTS_JSON_ERROR}" and an empty list.`,
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, {
			type: 'comments:updated',
			comments: [],
			error: COMMENTS_JSON_ERROR,
		});
		await settle(page);
		await shoot();
	},
);
bannerState(
	'all-stacked',
	'MCP unavailable + handoff stale + artboard:error + comments error at once (panel open).',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await postToChrome(page, { type: 'ui:status', mcpAvailable: false, handoffStale: true });
		await postToChrome(page, { type: 'artboard:error', message: 'Could not move frame "home".' });
		await postToChrome(page, {
			type: 'comments:updated',
			comments: [],
			error: COMMENTS_JSON_ERROR,
		});
		await settle(page);
		await shoot();
	},
);
bannerState(
	'ui-error-unmatched',
	'ui:error with no requestId, and one with an unknown requestId.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, { type: 'ui:error', message: 'Could not write comments.json.' });
		await postToChrome(page, {
			type: 'ui:error',
			message: 'Unrelated failure.',
			requestId: 'nobody',
		});
		await settle(page);
		await shoot();
	},
	['A ui:error that matches no request renders nothing, so the shot shows the unchanged chrome.'],
);

// 3. Stage
const stageState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
	notes?: string[],
): void => {
	add({ surface: 'stage', state, setup, notes, run });
};
stageState('empty', 'No canvas:updated (no artboards).', async ({ open, shoot }) => {
	await open({ noCanvas: true });
	await shoot();
});
stageState(
	'empty-panel-open',
	'No artboards, panel opened via saved state.',
	async ({ open, shoot }) => {
		await open({ noCanvas: true, panel: true });
		await shoot();
	},
);
stageState(
	'three-frames-100',
	'Three frames (Home 480, Pricing 420, Mobile 320; groups Web / Mobile) at 100%, no comments.',
	async ({ open, shoot }) => {
		await open({});
		await shoot();
	},
);
stageState(
	'no-groups',
	'Same frames with group removed (no group headings).',
	async ({ open, shoot }) => {
		await open({ frames: FRAMES.map(({ group: _group, ...rest }) => rest) });
		await shoot();
	},
);
stageState('fit-all', 'Clicked Fit all.', async ({ open, shoot, page }) => {
	await open({});
	await clickChrome(page.getByRole('button', { name: 'Fit all' }));
	await settle(page);
	await shoot();
});
stageState('zoom-50', 'Zoom 50%.', async ({ open, shoot, page }) => {
	await open({});
	await zoomSelect(page).selectOption('0.5');
	await settle(page);
	await shoot();
});
stageState('zoom-200', 'Zoom 200%.', async ({ open, shoot, page }) => {
	await open({});
	await zoomSelect(page).selectOption('2');
	await settle(page);
	await shoot();
});
stageState(
	'frame-label-hover',
	'Mouse over the Home frame label.',
	async ({ open, shoot, page }) => {
		await open({});
		const box = await boxOf(labelOf(page, 'home'));
		await page.mouse.move(box.x + 10, box.y + box.height / 2);
		await settle(page);
		await shoot();
	},
);
stageState(
	'resize-handle-hover',
	'Mouse over the right-edge resize handle of Home.',
	async ({ open, shoot, page }) => {
		await open({});
		const box = await boxOf(handleOf(page, 'home'));
		await page.mouse.move(box.x + box.width / 2, box.y + 200);
		await settle(page);
		await shoot({ closeup: { x: box.x - 40, y: box.y + 160, width: 90, height: 90 } });
	},
);
stageState(
	'drag-move-mid',
	'Mouse down on the Pricing label, moved +90,+50 in steps, screenshot before release.',
	async ({ open, shoot, page }) => {
		await open({});
		await frameGesture({ page, label: labelOf(page, 'pricing'), dx: 90, dy: 50, release: false });
		await settle(page);
		await shoot();
		await page.mouse.up();
	},
);
stageState(
	'drag-resize-mid',
	'Mouse down on Home right-edge handle, moved +70px, screenshot before release.',
	async ({ open, shoot, page }) => {
		await open({});
		const box = await boxOf(handleOf(page, 'home'));
		await page.mouse.move(box.x + box.width / 2, box.y + 200);
		await page.mouse.down();
		await page.mouse.move(box.x + 70, box.y + 200, { steps: 10 });
		await settle(page);
		await shoot();
		await page.mouse.up();
	},
);
stageState(
	'place-refused-error',
	'Dragged the Pricing label, released, host answered canvas:updated at base then artboard:error.',
	async ({ open, shoot, page }) => {
		await open({});
		await frameGesture({ page, label: labelOf(page, 'pricing'), dx: 90, dy: 50, release: true });
		await postToChrome(page, canvasUpdated(FRAMES));
		await postToChrome(page, {
			type: 'artboard:error',
			message: 'Could not move frame "pricing".',
		});
		await settle(page);
		await shoot();
	},
);
stageState(
	'error-tile',
	'Pricing posted with errorMessage (per-frame load failure) in place of html.',
	async ({ open, shoot }) => {
		await open({
			frames: FRAMES.map((frame) =>
				frame.id === 'pricing'
					? {
							...frame,
							html: '',
							errorMessage: 'Could not read pricing.html: it is larger than 2 MB.',
						}
					: frame,
			),
		});
		await shoot();
	},
);
stageState('empty-artboard-tile', 'Pricing posted with empty html.', async ({ open, shoot }) => {
	await open({
		frames: FRAMES.map((frame) => (frame.id === 'pricing' ? { ...frame, html: '' } : frame)),
	});
	await shoot();
});
stageState(
	'fit-many-frames',
	'Seven frames (3 real + 4 copies of Mobile) in two groups, Fit all.',
	async ({ open, shoot, page }) => {
		const extra: PostedCanvasFrame[] = [0, 1, 2, 3].map((index) => ({
			id: `m${index}`,
			label: `Mobile ${index + 2}`,
			x: 1272 + index * 344,
			y: index % 2 === 0 ? 0 : 60,
			width: 320,
			group: 'Mobile',
			generation: 1,
			html: MOBILE_HTML,
		}));
		await open({ frames: [...FRAMES, ...extra] });
		await clickChrome(page.getByRole('button', { name: 'Fit all' }));
		await settle(page);
		await shoot();
	},
);

// 4. Comment mode and the popover
add({
	surface: 'comment',
	state: 'hover-outline',
	setup: 'Comment mode on, mouse over the #feature-2 card in Home (view scrolled down 280px).',
	run: async ({ open, shoot, page }) => {
		await open({ view: { x: 6, y: -280, zoom: 1 } });
		await clickChrome(commentButton(page));
		await hoverOver(page, await pointIn({ page, frameId: 'home', selector: '#feature-2' }));
		await shoot();
	},
});
add({
	surface: 'comment',
	state: 'hover-outline-small',
	setup: 'Comment mode, mouse over #nav-cta (a small button) with the default view.',
	run: async ({ open, shoot, page }) => {
		await open({});
		await clickChrome(commentButton(page));
		await hoverOver(page, await pointIn({ page, frameId: 'home', selector: '#nav-cta' }), 10);
		await shoot();
	},
});
const popoverState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
): void => {
	add({ surface: 'popover', state, setup, run });
};
const shootPopover = async ({ shoot, page }: Session): Promise<void> => {
	await settle(page);
	await shoot({ closeup: await boxOf(popover(page)) });
};
popoverState(
	'empty',
	'Comment mode, clicked #hero-title; popover opened, textarea focused, Add disabled.',
	async (session) => {
		await session.open({});
		await pickElement(session.page, 'home', '#hero-title');
		await shootPopover(session);
	},
);
popoverState('with-text', 'Same pick, typed a two-line body.', async (session) => {
	await session.open({});
	await pickElement(session.page, 'home', '#hero-title');
	await session.page.keyboard.type(
		'Make the headline one line on tablet and drop the second clause.',
	);
	await session.page.keyboard.press('Shift+Enter');
	await session.page.keyboard.type('Keep the weight at 800.');
	await shootPopover(session);
});
popoverState(
	'long-chip-text',
	'Picked #deep-target (long element text, deep selector) after scrolling the view.',
	async (session) => {
		await session.open({ view: { x: 6, y: -520, zoom: 1 } });
		await pickElement(session.page, 'home', '#deep-target');
		await session.page.keyboard.type('Spec text reads awkwardly.');
		await shootPopover(session);
	},
);
popoverState(
	'page-pick',
	'Clicked the empty body area under the footer of Home (whole-frame pick).',
	async (session) => {
		const { page } = session;
		await session.open({});
		const home = await frameBox(page, 'home');
		const stage = await stageBox(page);
		// Re-open with the view scrolled so the bottom of Home is on screen.
		await session.reopen({ view: { x: 6, y: stage.height - 40 - home.height, zoom: 1 } });
		await clickChrome(commentButton(page));
		const frame = await frameBox(page, 'home');
		const point = { x: frame.x + 240, y: frame.y + frame.height - 20 };
		await page.mouse.move(point.x, point.y, { steps: 4 });
		await page.mouse.move(point.x + 1, point.y);
		await page.waitForTimeout(150);
		await clickAt(page, point);
		await expect(popover(page)).toBeVisible();
		await shootPopover(session);
	},
);
popoverState(
	'near-right-bottom-edge',
	'Re-opened with the view panned so #m-fab (bottom-right of Mobile) sits ~30px from the stage corner, then picked it.',
	async (session) => {
		const { page } = session;
		await session.open({});
		const stage = await stageBox(page);
		const point = await pointIn({ page, frameId: 'mobile', selector: '#m-fab' });
		await session.reopen({
			view: {
				x: VIEW.x + (stage.x + stage.width - 30 - point.x),
				y: VIEW.y + (stage.y + stage.height - 30 - point.y),
				zoom: 1,
			},
		});
		await pickElement(page, 'mobile', '#m-fab');
		await shootPopover(session);
	},
);
popoverState(
	'host-error',
	'Typed a body, pressed Add comment, host answered ui:error with the matching requestId.',
	async (session) => {
		const { page } = session;
		await session.open({});
		await pickElement(page, 'home', '#hero-sub');
		await page.keyboard.type('Tighten this copy.');
		await page.keyboard.press('Enter');
		const request = await lastRequest(page, 'comment:create');
		await postToChrome(page, {
			type: 'ui:error',
			message: 'Could not save the comment. Fix .cursor-design/comments.json and try again.',
			requestId: String(request.requestId),
		});
		await shootPopover(session);
	},
);
popoverState(
	'pending',
	'Typed a body, pressed Add comment, no host answer yet (pending).',
	async (session) => {
		const { page } = session;
		await session.open({});
		await pickElement(page, 'home', '#hero-sub');
		await page.keyboard.type('Tighten this copy.');
		await page.keyboard.press('Enter');
		await lastRequest(page, 'comment:create');
		await shootPopover(session);
	},
);
popoverState(
	'no-version-blocked',
	'Frame generation 0 (no artboard version): pick then type; the blocked-target copy shows.',
	async (session) => {
		await session.open({
			frames: FRAMES.map((frame) => (frame.id === 'home' ? { ...frame, generation: 0 } : frame)),
		});
		await pickElement(session.page, 'home', '#hero-title');
		await session.page.keyboard.type('Why is Add disabled?');
		await shootPopover(session);
	},
);

// 5. Pins and badges
const pinsState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
): void => {
	add({ surface: 'pins', state, setup, run });
};
pinsState(
	'default',
	'11 comments across the three frames: open, sent, resolved, missing, stale, unchecked and a page pin.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await shoot({ closeup: await boxOf(page.locator('[data-cd-frame-id="home"]')) });
	},
);
pinsState(
	'status-and-badges',
	'Zoom 75% so all Home pins are on screen (open, sent, resolved, missing, stale, unchecked, page); the close-up crops their bounding box.',
	async ({ open, shoot, page }) => {
		await open(withComments({ view: { x: 6, y: 76, zoom: 0.75 } }));
		const boxes = await Promise.all(
			['h-title', 'h-sub', 'h-cta', 'h-f2', 'h-old', 'h-nav', 'h-art', 'h-page'].map((id) =>
				boxOf(pinOf(page, id)),
			),
		);
		await shoot({ closeup: unionOf(boxes) });
	},
);
pinsState(
	'many-on-one-frame',
	'24 comments on Home with clustered pins (two per target, differing pin fractions).',
	async ({ open, shoot, page }) => {
		const targets = [
			'#hero-title',
			'#hero-sub',
			'#cta-primary',
			'#cta-secondary',
			'#hero-art',
			'#nav-cta',
			'#feature-1',
			'#feature-2',
			'#feature-3',
		];
		const definitions: Definition[] = Array.from({ length: 24 }, (_, index) => {
			const selector = targets[index % targets.length] as string;
			return {
				id: `m-${index}`,
				frameId: 'home',
				selector,
				tagName: 'div',
				text: selector.slice(1),
				body: `Note ${index + 1} on ${selector}`,
				status: index % 6 === 2 ? 'resolved' : index % 6 === 4 ? 'sent' : 'open',
				pin: { x: 0.15 + ((index * 0.37) % 0.7), y: 0.2 + ((index * 0.23) % 0.6) },
				stale: index % 8 === 5,
				createdAt: ago(10 + index),
			};
		});
		await open({ definitions });
		await shoot({ closeup: await boxOf(page.locator('[data-cd-frame-id="home"]')) });
	},
);
pinsState(
	'zoomed-out-50',
	'Default comments at zoom 50%; pins stay a fixed size.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await zoomSelect(page).selectOption('0.5');
		await settle(page);
		await shoot();
	},
);
pinsState('zoomed-in-200', 'Default comments at zoom 200%.', async ({ open, shoot, page }) => {
	await open(withComments());
	await zoomSelect(page).selectOption('2');
	await settle(page);
	await shoot();
});
pinsState(
	'comment-mode-with-pins',
	'Comment mode on with pins visible (pins stay clickable while commenting).',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await clickChrome(commentButton(page));
		await hoverOver(page, await pointIn({ page, frameId: 'home', selector: '#feature-3' }), 30);
		await shoot();
	},
);

// 6. Thread
const threadState = ({
	state,
	setup,
	id,
	definitions = SHORT,
	extra,
	view,
}: {
	state: string;
	setup: string;
	id: string;
	definitions?: Definition[];
	extra?: (session: Session) => Promise<void>;
	view?: View;
}): void => {
	add({
		surface: 'thread',
		state,
		setup,
		run: async (session) => {
			await session.open({ definitions, view });
			await openThread(session.page, id);
			await extra?.(session);
			await session.shoot({ closeup: await boxOf(thread(session.page)) });
		},
	});
};
const withFirst = (change: Partial<Definition>): Definition[] => [
	{ ...(SHORT[0] as Definition), ...change },
	...SHORT.slice(1),
];
const typeReply = async (page: Page, text: string, submit = false): Promise<void> => {
	await clickChrome(threadButton(page, 'Reply'));
	await page.keyboard.type(text);
	if (submit) {
		await page.keyboard.press('Enter');
	}
};

threadState({ state: 'short', setup: 'Clicked the open pin on #hero-title.', id: 'h-title' });
threadState({
	state: 'with-agent-reply',
	setup: 'Clicked the sent pin on #hero-sub (a user reply and an Agent reply).',
	id: 'h-sub',
});
threadState({
	state: 'resolved-with-reply',
	setup:
		'View scrolled down 280px; clicked the resolved pin on #feature-2 (Reopen button, Agent reply).',
	id: 'h-f2',
	view: { x: 6, y: -280, zoom: 1 },
});
threadState({
	state: 'stale-badge',
	setup: 'Clicked the stale pin on #nav-cta (stale flag in the card).',
	id: 'h-nav',
});
threadState({
	state: 'missing-badge',
	setup: 'Clicked the missing-target pin (#promo-banner).',
	id: 'h-old',
});
threadState({
	state: 'unchecked-badge',
	setup: 'Clicked the unchecked pin on #hero-art.',
	id: 'h-art',
});
threadState({ state: 'page-comment', setup: 'Clicked the whole-frame (page) pin.', id: 'h-page' });
threadState({
	state: 'long-body',
	setup: 'Open comment with a ~900 character body including an unbroken 150-char token.',
	id: 'h-title',
	definitions: withFirst({
		body: `${SENTENCES.join(' ')} ${SENTENCES.join(' ')} ${SENTENCES.join(' ')} https://example.com/${'a-very-long-unbroken-path-segment-'.repeat(5)}`,
	}),
});
threadState({
	state: 'markup-body',
	setup: 'Body contains HTML, markdown and entities; it renders as literal text.',
	id: 'h-title',
	definitions: withFirst({
		body: '<img src=x onerror=alert(1)> <b>bold?</b> **markdown** `code` [link](https://x.test) &amp; &lt;script&gt;\n\n- list item one\n- list item two',
	}),
});
threadState({
	state: 'many-replies',
	setup: 'A comment with 7 replies alternating user and Agent.',
	id: 'h-title',
	definitions: withFirst({
		replies: Array.from({ length: 7 }, (_, index) => ({
			id: `mr${index}`,
			author: index % 2 === 0 ? ('user' as const) : ('agent' as const),
			body:
				index % 2 === 0
					? 'Looks better, but the left alignment is still off by a few pixels on mobile.'
					: 'Adjusted padding to 16px in version 6 and re-exported the handoff.',
			createdAt: ago(300 - index * 30),
		})),
	}),
});
threadState({
	state: 'reply-composer-open',
	setup: 'Clicked Reply in the thread; typed a draft.',
	id: 'h-title',
	extra: async ({ page }) => {
		await typeReply(page, 'Agreed. I will update the type scale too.');
		await settle(page);
	},
});
threadState({
	state: 'reply-pending',
	setup: 'Typed a reply and pressed Enter; no host answer yet.',
	id: 'h-title',
	extra: async ({ page }) => {
		await typeReply(page, 'Agreed. I will update the type scale too.', true);
		await lastRequest(page, 'comment:reply');
		await settle(page);
	},
});
threadState({
	state: 'reply-error',
	setup: 'Reply submitted, host answered ui:error (reply limit).',
	id: 'h-title',
	extra: async ({ page }) => {
		await typeReply(page, 'One more thought', true);
		const request = await lastRequest(page, 'comment:reply');
		await postToChrome(page, {
			type: 'ui:error',
			message: 'This comment has the maximum number of replies.',
			requestId: String(request.requestId),
		});
		await settle(page);
	},
});
threadState({
	state: 'resolve-error',
	setup: 'Clicked Resolve, host answered ui:error.',
	id: 'h-title',
	extra: async ({ page }) => {
		await clickChrome(threadButton(page, 'Resolve'));
		const request = await lastRequest(page, 'comment:set-status');
		await postToChrome(page, {
			type: 'ui:error',
			message: 'Could not resolve the comment.',
			requestId: String(request.requestId),
		});
		await settle(page);
	},
});
threadState({
	state: 'copied',
	setup: 'Clicked Copy for Agent, host answered ui:copied (the button reads Copied).',
	id: 'h-title',
	extra: async ({ page }) => {
		await clickChrome(threadButton(page, 'Copy for Agent'));
		const request = await lastRequest(page, 'comment:copy');
		await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 1 });
		await page.waitForTimeout(100);
	},
});
add({
	surface: 'thread',
	state: 'near-right-edge',
	setup: 'Panned so the Mobile #m-cta pin is ~40px from the stage right edge; opened its thread.',
	run: async (session) => {
		const { page } = session;
		await session.open(withComments());
		const stage = await stageBox(page);
		const pin = await boxOf(pinOf(page, 'm-cta'));
		await session.reopen({
			view: {
				x: VIEW.x + (stage.x + stage.width - 40 - (pin.x + pin.width / 2)),
				y: VIEW.y + 100,
				zoom: 1,
			},
		});
		await openThread(page, 'm-cta');
		await session.shoot({ closeup: await boxOf(thread(page)) });
	},
});
add({
	surface: 'thread',
	state: 'with-panel-open',
	setup: 'Panel open and the thread of #hero-sub open at the same time.',
	run: async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await openThread(page, 'h-sub');
		await shoot();
	},
});

// 7. Comments panel
const panelState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
): void => {
	add({ surface: 'panel', state, setup, run });
};
const answerError = async (page: Page, type: string, message: string): Promise<void> => {
	const request = await lastRequest(page, type);
	await postToChrome(page, { type: 'ui:error', message, requestId: String(request.requestId) });
	await settle(page);
};
const REPLY_LIMIT = 'This comment has the maximum number of replies.';

panelState('empty', 'Panel open, no comments.', async ({ open, shoot }) => {
	await open({ definitions: [], panel: true });
	await shoot();
});
panelState('error', 'Panel open, comments:updated with error.', async ({ open, shoot, page }) => {
	await open({ definitions: [], panel: true });
	await postToChrome(page, { type: 'comments:updated', comments: [], error: COMMENTS_JSON_ERROR });
	await settle(page);
	await shoot();
});
panelState(
	'typical',
	'Panel open with the 11 default comments (9 open, 1 sent, 1 resolved; Agent replies).',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await shoot({ closeup: await boxOf(panelItem(page, 'h-sub')) });
	},
);
panelState(
	'card-close-ups',
	'Close-up of a plain open card (h-title) in the full panel.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'long-list-top',
	'26 comments with long bodies, long targets and 8 Agent replies; panel scrolled to top.',
	async ({ open, shoot }) => {
		await open({ definitions: longList(), panel: true });
		await shoot();
	},
);
panelState(
	'long-list-scrolled',
	'Same list scrolled ~60% down (the Resolved group heading comes into view).',
	async ({ open, shoot, page }) => {
		await open({ definitions: longList(), panel: true });
		// The list, not the aside, is the scroller.
		await panel(page)
			.locator('.list')
			.evaluate((element) => {
				element.scrollTop = element.scrollHeight * 0.6;
			});
		await settle(page);
		await shoot();
	},
);
panelState('long-list-bottom', 'Same list scrolled to the end.', async ({ open, shoot, page }) => {
	await open({ definitions: longList(), panel: true });
	await panel(page)
		.locator('.list')
		.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
	await settle(page);
	await shoot();
});
panelState(
	'reply-composer-open',
	'Clicked Reply on the #hero-title card in the panel and typed a draft.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Reply'));
		await page.keyboard.type('Agreed, and the subhead too.');
		await settle(page);
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'reply-error',
	'Reply submitted from the panel, host answered ui:error.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Reply'));
		await page.keyboard.type('One more thought');
		await page.keyboard.press('Enter');
		await answerError(page, 'comment:reply', REPLY_LIMIT);
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'resolve-error',
	'Clicked Resolve on the #hero-title card in the panel, host answered ui:error.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Resolve'));
		await answerError(page, 'comment:set-status', 'Could not resolve the comment.');
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'copy-for-agent-copied',
	'Clicked Copy for Agent on the #hero-title card, host answered ui:copied (count 1): the button says Copied for 1.5 s.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Copy for Agent'));
		const request = await lastRequest(page, 'comment:copy');
		await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 1 });
		await page.waitForTimeout(100);
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'copy-open-copied',
	'Clicked Copy 9 open comments for Agent, host answered ui:copied (count 9).',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(copyOpenButton(page));
		const request = await lastRequest(page, 'comment:copy-open');
		await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 9 });
		await page.waitForTimeout(100);
		await shoot();
	},
);
panelState(
	'copy-open-error',
	'Clicked Copy 9 open comments for Agent, host answered ui:error.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(copyOpenButton(page));
		await answerError(page, 'comment:copy-open', 'Could not copy to the clipboard.');
		await shoot();
	},
);
panelState(
	'copy-open-disabled',
	'Only sent and resolved comments: the copy-open button is aria-disabled.',
	async ({ open, shoot }) => {
		await open({
			definitions: SHORT.filter(
				(definition) => definition.status === 'sent' || definition.status === 'resolved',
			),
			panel: true,
		});
		await shoot();
	},
);
panelState(
	'frame-absent',
	'Added a comment whose frame (archive-2) is not on the stage, plus normal ones.',
	async ({ open, shoot, page }) => {
		const orphan: Definition = {
			id: 'o-1',
			frameId: 'archive-2',
			selector: '#hero-title',
			tagName: 'h1',
			text: 'Old landing headline',
			body: 'This frame was removed from the canvas but the comment stayed.',
			rect: { x: 20, y: 40, width: 300, height: 40 },
			createdAt: ago(60 * 30),
		};
		await open({ definitions: [...SHORT, orphan], panel: true });
		await panelItem(page, 'o-1').evaluate((element) => {
			element.scrollIntoView({ block: 'center' });
		});
		await settle(page);
		await shoot({ closeup: await boxOf(panelItem(page, 'o-1')) });
	},
);
panelState(
	'jump-flash',
	'Clicked the target chip of the #cta-primary card (click to jump): flash outline on the stage.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(jumpChip(page, 'h-cta'));
		await page.waitForTimeout(200);
		await shoot();
	},
);
panelState('only-resolved', 'Only resolved comments in the list.', async ({ open, shoot }) => {
	await open({
		definitions: SHORT.filter((definition) => definition.status === 'resolved'),
		panel: true,
	});
	await shoot();
});

// 8. Keyboard focus
const focusState = ({
	state,
	setup,
	target,
	panelOpen = false,
	closeup = false,
}: {
	state: string;
	setup: string;
	target: (page: Page) => Locator;
	panelOpen?: boolean;
	closeup?: boolean;
}): void => {
	add({
		surface: 'focus',
		state,
		setup,
		run: async ({ open, shoot, page }) => {
			await open(withComments({ panel: panelOpen }));
			// A key press first, so :focus-visible applies to the scripted focus.
			await page.keyboard.press('Tab');
			await target(page).focus();
			await settle(page);
			await shoot(closeup ? { closeup: await boxOf(target(page)) } : {});
		},
	});
};
focusState({
	state: 'toolbar-comment-button',
	setup: 'Tab then focus() on the Comment segment.',
	target: commentButton,
	closeup: true,
});
focusState({
	state: 'toolbar-comments-button',
	setup: 'Focus on the Comments button.',
	target: panelToggle,
	closeup: true,
});
focusState({
	state: 'toolbar-zoom-select',
	setup: 'Focus on the Zoom select.',
	target: zoomSelect,
	closeup: true,
});
focusState({
	state: 'toolbar-fit-all',
	setup: 'Focus on Fit all.',
	target: (page) => page.getByRole('button', { name: 'Fit all' }),
	closeup: true,
});
focusState({
	state: 'frame-label',
	setup: 'Focus on the Pricing frame label.',
	target: (page) => labelOf(page, 'pricing'),
});
focusState({
	state: 'frame-resize-handle',
	setup: 'Focus on the Home resize handle.',
	target: (page) => handleOf(page, 'home'),
});
focusState({
	state: 'pin',
	setup: 'Focus on the #hero-title pin.',
	target: (page) => pinOf(page, 'h-title'),
});
focusState({
	state: 'panel-card-button',
	setup: 'Panel open, focus on the Resolve button of the #hero-title card.',
	target: (page) => panelButton(page, 'h-title', 'Resolve'),
	panelOpen: true,
});
focusState({
	state: 'panel-card-chip',
	setup: 'Panel open, focus on the target chip (jump) of the #cta-primary card.',
	target: (page) => jumpChip(page, 'h-cta'),
	panelOpen: true,
});
focusState({
	state: 'panel-copy-open',
	setup: 'Panel open, focus on the copy-open button.',
	target: copyOpenButton,
	panelOpen: true,
});
add({
	surface: 'focus',
	state: 'popover-textarea',
	setup: 'Popover open, textarea focused by default.',
	run: async (session) => {
		await session.open({});
		await pickElement(session.page, 'home', '#hero-title');
		await shootPopover(session);
	},
});
add({
	surface: 'focus',
	state: 'popover-button',
	setup: 'Popover open, Tab moved to the Add comment button after typing.',
	run: async (session) => {
		const { page } = session;
		await session.open({});
		await pickElement(page, 'home', '#hero-title');
		await page.keyboard.type('Looks good');
		await popover(page).getByRole('button', { name: 'Add comment' }).focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await shootPopover(session);
	},
});

const pad2 = (value: number): string => String(value).padStart(2, '0');

const openScene = async ({
	page,
	theme,
	options,
}: {
	page: Page;
	theme: VscodeTheme;
	options: OpenOptions;
}): Promise<void> => {
	await openHarness(page, {
		vscodeHost: theme,
		state: {
			stageView: options.view ?? VIEW,
			...(options.panel === true ? { commentsPanelOpen: true } : {}),
		},
	});
	// Evidence is taken at rest: a colour read mid-transition is neither state's colour.
	await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
	if (options.noCanvas !== true) {
		const frames = options.frames ?? FRAMES;
		await postToChrome(page, canvasUpdated(frames));
		for (const frame of frames) {
			if (frame.html !== '' && frame.errorMessage === undefined) {
				await untilHeightReported(page, frame.id);
			}
		}
	}
	const definitions = options.definitions ?? [];
	if (definitions.length > 0) {
		const frames = options.noCanvas === true ? [] : (options.frames ?? FRAMES);
		// A comment whose frame is not drawn (or is empty) only keeps its stored rect.
		const comments = await Promise.all(
			definitions
				.filter(
					(definition) =>
						definition.rect !== undefined ||
						frames.some((frame) => frame.id === definition.frameId && frame.html !== ''),
				)
				.map((definition) => buildComment(page, definition)),
		);
		await postToChrome(page, { type: 'comments:updated', comments });
		for (const id of IFRAME_IDS) {
			const wanted = definitions.some(
				(definition) => definition.frameId === id && definition.isPage !== true,
			);
			if (wanted && frames.some((frame) => frame.id === id)) {
				await expect
					.poll(
						async () =>
							(await messagesOfType({ page, frameId: id, type: FRAME_ANCHOR_RECTS_MESSAGE }))
								.length,
					)
					.toBeGreaterThan(0);
			}
		}
	}
	await settle(page);
};

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
		// F-99: the pin ring touches the pin's halo (offset 2px), so it is measured against both.
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

		// The panel with nothing to send: the primary button is disabled.
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

		// Disabled toolbar controls with no artboard.
		await open({ noCanvas: true });
		await text(
			'disabled text (segment, no artboard)',
			'.mode button',
			'disabled text (WCAG 1.4.3)',
		);
	});
}
