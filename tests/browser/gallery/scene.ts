import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME_ANCHOR_RECTS_MESSAGE } from '../../../src/webview/frame/frameMessages';
import { type PostedCanvasFrame, type PostedComment } from '../../../src/webview/hostMessages';
import {
	type Box,
	canvasUpdated,
	frameOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	postToChrome,
	untilHeightReported,
} from '../harness';
import { type VscodeTheme } from '../vscodeHost';

const ARTBOARDS = join(__dirname, '..', '..', '..', 'fixtures', 'gallery');

const artboard = (name: string): string => readFileSync(join(ARTBOARDS, `${name}.html`), 'utf8');
const HOME_HTML = artboard('home');
export const MOBILE_HTML = artboard('mobile');

export const FRAMES: PostedCanvasFrame[] = [
	{
		id: 'home',
		label: 'Home',
		x: 0,
		y: 0,
		width: 480,
		group: 'Web',
		generation: 3,
		hash: 'sha256:test',
		canUndo: false,
		canRedo: false,
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
		hash: 'sha256:test',
		canUndo: false,
		canRedo: false,
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
		hash: 'sha256:test',
		canUndo: false,
		canRedo: false,
		html: MOBILE_HTML,
	},
];
const IFRAME_IDS = ['home', 'pricing', 'mobile'];
export const VIEW = { x: 6, y: 76, zoom: 1 };

export type View = { x: number; y: number; zoom: number };
export type Definition = Partial<PostedComment> &
	Pick<PostedComment, 'id' | 'frameId' | 'selector' | 'tagName' | 'text' | 'body'>;

export const ago = (minutes: number): string =>
	new Date(Date.now() - minutes * 60_000).toISOString();

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

export const SHORT: Definition[] = [
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

export const SENTENCES = [
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

export const longList = (): Definition[] => {
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

export type OpenOptions = {
	frames?: PostedCanvasFrame[];
	view?: View;
	definitions?: Definition[];
	panel?: boolean;
	noCanvas?: boolean;
};

export type Session = {
	page: Page;
	open: (options?: OpenOptions) => Promise<void>;
	reopen: (options: OpenOptions) => Promise<void>;
	shoot: (options?: { closeup?: Box }) => Promise<void>;
};

export type StateDefinition = {
	surface: string;
	state: string;
	setup: string;
	notes?: string[];
	run: (session: Session) => Promise<void>;
};

// Paints, pauses 220 ms and paints again before a shot. openScene turns transitions off in the
// chrome document only, not inside artboard frames.
export const settle = async (page: Page): Promise<void> => {
	await nextAnimationFrame(page);
	await page.waitForTimeout(220);
	await nextAnimationFrame(page);
};

export const withComments = (extra: Partial<OpenOptions> = {}): OpenOptions => ({
	definitions: SHORT,
	...extra,
});

export const MCP_DOWN = { type: 'ui:status', mcpAvailable: false, handoffStale: false } as const;
export const HANDOFF_STALE = { type: 'ui:status', mcpAvailable: true, handoffStale: true } as const;
export const COMMENTS_JSON_ERROR =
	'comments.json is not valid. Fix or delete .cursor-design/pages/page-1/comments.json.';

export const openScene = async ({
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
			stageView: { ...(options.view ?? VIEW), pageId: 'page-1' },
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
		await postToChrome(page, { type: 'comments:updated', pageId: 'page-1', comments });
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
