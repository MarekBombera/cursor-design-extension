import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { parseArtboardDocument } from '../../src/disk/commentTarget';
import { sourceTaggedHtml } from '../../src/disk/sourceTags';
import type { PostedCanvasFrame, PostedComment } from '../../src/webview/hostMessages';
import type { StageView } from '../../src/webview/stageGeometry';
import { captureAt2x } from './gallery/interact';
import {
	boxOf,
	canvasUpdated,
	centerOf,
	clickChrome,
	commentButton,
	enterEditMode,
	frameBox,
	frameOf,
	inspector,
	lastRequest,
	nextAnimationFrame,
	openHarness,
	panel,
	panelButton,
	panelToggle,
	type Point,
	popover,
	postToChrome,
	untilHeightReported,
	zoomReadout,
} from './harness';

// Marketing shots, not a gate: the README and portfolio stills and the frames of the demo clip,
// from the real chrome with a stubbed host. Skipped unless CD_SHOWCASE=1 (`pnpm showcase`); writes
// to the git-ignored test-results/showcase/. The picked files are copied into media/ by hand.
test.skip(process.env.CD_SHOWCASE !== '1', 'Set CD_SHOWCASE=1 (pnpm showcase) to run.');

const OUT = join(__dirname, '..', '..', 'test-results', 'showcase');
const ARTBOARDS = join(__dirname, '..', '..', 'fixtures', 'showcase');
const PAGES = [{ id: 'page-1', title: 'Alto', updatedAt: null }];

const SHORT_LINE = 'Spend, save and get paid from one account. No fees.';

// The agent's edit: the same artboard with the long line under the headline cut down.
const withShortLine = (html: string): string =>
	html.replace(/(<p id="hero-line">)[\s\S]*?(<\/p>)/, `$1${SHORT_LINE}$2`);

const tagged = (html: string): string =>
	sourceTaggedHtml({ html, document: parseArtboardDocument(html) });

const artboard = (name: string): string => readFileSync(join(ARTBOARDS, `${name}.html`), 'utf8');

const frames = ({ shortLine = false, generation = 3 } = {}): PostedCanvasFrame[] => {
	const shared = { y: 0, hash: 'sha256:showcase', canUndo: false, canRedo: false };
	const home = artboard('home');
	return [
		{
			...shared,
			id: 'home',
			label: 'Landing',
			group: 'Web',
			x: 0,
			width: 1200,
			generation,
			html: tagged(shortLine ? withShortLine(home) : home),
		},
		{
			...shared,
			id: 'app',
			label: 'Home',
			group: 'Mobile',
			x: 1224,
			width: 390,
			generation: 2,
			html: tagged(artboard('app')),
		},
		{
			...shared,
			id: 'send',
			label: 'Send money',
			group: 'Mobile',
			x: 1638,
			width: 390,
			generation: 1,
			html: tagged(artboard('send')),
		},
	];
};

const postCanvas = async (page: Page, canvasFrames: PostedCanvasFrame[]): Promise<void> => {
	await postToChrome(page, { ...canvasUpdated(canvasFrames), pages: PAGES });
};

const settle = async (page: Page, milliseconds = 300): Promise<void> => {
	await nextAnimationFrame(page);
	await page.waitForTimeout(milliseconds);
	await nextAnimationFrame(page);
};

const open = async (
	page: Page,
	options: { view?: StageView; panel?: boolean; shortLine?: boolean } = {},
): Promise<void> => {
	await openHarness(page, {
		vscodeHost: 'dark',
		state: {
			...(options.view === undefined ? {} : { stageView: { ...options.view, pageId: 'page-1' } }),
			...(options.panel === true ? { commentsPanelOpen: true } : {}),
		},
	});
	const canvasFrames =
		options.shortLine === true ? frames({ shortLine: true, generation: 4 }) : frames();
	await postCanvas(page, canvasFrames);
	for (const frame of canvasFrames) {
		await untilHeightReported(page, frame.id);
	}
	await settle(page);
};

const fitAll = async (page: Page): Promise<void> => {
	await clickChrome(page.getByRole('button', { name: 'Fit all', exact: true }));
	await page.mouse.move(0, 0);
	await settle(page);
};

// A point inside a frame element, as viewport px. Measured from the iframe, not the frame wrapper
// (the wrapper also holds the frame's label row).
const pointInFrame = async ({
	page,
	frameId,
	selector,
	fx,
	fy,
}: {
	page: Page;
	frameId: string;
	selector: string;
	fx: number;
	fy: number;
}): Promise<Point> => {
	const iframe = await boxOf(page.locator(`[data-cd-frame-id="${frameId}"] iframe`));
	const target = await (
		await frameOf(page, frameId)
	).evaluate((wanted) => {
		const element = document.querySelector(wanted);
		if (element === null) {
			throw new Error(`No element for ${wanted}`);
		}
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height, frameWidth: window.innerWidth };
	}, selector);
	const scale = iframe.width / target.frameWidth;
	return {
		x: iframe.x + (target.x + target.width * fx) * scale,
		y: iframe.y + (target.y + target.height * fy) * scale,
	};
};

const minutesAgo = (minutes: number): string =>
	new Date(Date.now() - minutes * 60_000).toISOString();

type CommentSeed = Pick<PostedComment, 'id' | 'frameId' | 'selector' | 'tagName' | 'body'> &
	Partial<PostedComment>;

// The target's rect and text come from the live frame, so pins land on real elements.
const comment = async (page: Page, seed: CommentSeed): Promise<PostedComment> => {
	const target = await (
		await frameOf(page, seed.frameId)
	).evaluate((selector) => {
		const element = document.querySelector(selector);
		if (element === null) {
			throw new Error(`No element for ${selector}`);
		}
		const { x, y, width, height } = element.getBoundingClientRect();
		return {
			rect: { x, y, width, height },
			text: (element.textContent ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 80),
		};
	}, seed.selector);
	return {
		pin: { x: 0.5, y: 0.5 },
		isPage: false,
		status: 'open',
		createdAt: minutesAgo(12),
		replies: [],
		stale: false,
		targetMissing: false,
		...target,
		...seed,
	};
};

const COMMENTS: CommentSeed[] = [
	{
		id: 'c-line',
		frameId: 'home',
		selector: '#hero-line',
		tagName: 'p',
		body: 'Too wordy. One short line, and keep "no fees".',
		pin: { x: 0.02, y: 0.5 },
		createdAt: minutesAgo(41),
		replies: [
			{
				id: 'r-line',
				author: 'agent',
				body: `Cut it to "${SHORT_LINE}" Saved as version 4.`,
				createdAt: minutesAgo(38),
			},
			{
				id: 'r-line-2',
				author: 'user',
				body: 'Much better. Now that it is short, try it a size bigger.',
				createdAt: minutesAgo(11),
			},
		],
	},
	{
		id: 'c-nav',
		frameId: 'home',
		selector: '#nav-cta',
		tagName: 'a',
		body: 'Say "Open an account" here too, same as the hero button.',
		pin: { x: 0.1, y: 0.5 },
		createdAt: minutesAgo(9),
	},
	{
		id: 'c-spend',
		frameId: 'home',
		selector: '#spend-total',
		tagName: 'div',
		body: 'Show the change from last month next to the total.',
		pin: { x: 0.7, y: 0.3 },
		createdAt: minutesAgo(6),
	},
	{
		id: 'c-pot',
		frameId: 'home',
		selector: '#pot-rainy',
		tagName: 'div',
		text: 'Rainy day',
		body: 'Put Rainy day first. It is the pot most people open.',
		pin: { x: 0.02, y: 0.3 },
		createdAt: minutesAgo(4),
	},
	{
		id: 'c-balance',
		frameId: 'app',
		selector: '#balance',
		tagName: 'div',
		body: 'Let people hide the balance with a tap.',
		pin: { x: 0.05, y: 0.5 },
		createdAt: minutesAgo(2),
	},
];

const postComments = async (page: Page, comments: PostedComment[]): Promise<void> => {
	await postToChrome(page, { type: 'comments:updated', pageId: 'page-1', comments });
	await settle(page, 500);
};

// 2x through CDP: an emulated deviceScaleFactor of 2 lays the sandboxed frames out at half width.
const capture = async (page: Page, path: string): Promise<void> => {
	const size = page.viewportSize() ?? { width: 1280, height: 800 };
	await captureAt2x(page, path, { x: 0, y: 0, ...size });
};

const shoot = (page: Page, name: string): Promise<void> => capture(page, join(OUT, `${name}.png`));

test.beforeAll(() => {
	mkdirSync(OUT, { recursive: true });
});

test.describe('stills', () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test('canvas', async ({ page }) => {
		await open(page);
		await fitAll(page);
		await shoot(page, 'canvas');
	});

	test('comments', async ({ page }) => {
		await open(page, { view: { x: 28, y: 64, zoom: 0.86 }, panel: true, shortLine: true });
		const comments: PostedComment[] = [];
		for (const seed of COMMENTS) {
			comments.push(await comment(page, seed));
		}
		await postComments(page, comments);
		await shoot(page, 'comments');
	});

	test('edit', async ({ page }) => {
		await open(page, { view: { x: 28, y: 64, zoom: 0.86 } });
		await enterEditMode(page);
		const line = await pointInFrame({
			page,
			frameId: 'home',
			selector: '#headline',
			fx: 0.3,
			fy: 0.3,
		});
		await page.mouse.click(line.x, line.y);
		await expect(inspector(page).getByText(/^Landing › /)).toBeVisible();
		await page.mouse.move(0, 0);
		await settle(page);
		await shoot(page, 'edit');
	});
});

// The demo clip is stop-motion: one screenshot per step with the time it should stay on screen,
// joined by ffmpeg from demo/frames.txt (ffconcat). Nothing depends on real time, so it is
// repeatable. Headless Chromium draws no pointer, so the clip gets its own.
const CURSOR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 9.5-6.6 1.4L8 19z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

type Recorder = {
	frame: (seconds?: number) => Promise<void>;
	hold: (seconds: number) => void;
	moveTo: (target: Point, steps?: number) => Promise<void>;
	click: () => Promise<void>;
	type: (text: string) => Promise<void>;
	save: () => void;
};

const STEP_SECONDS = 1 / 25;

const recorder = async (page: Page, start: Point): Promise<Recorder> => {
	const shots: { file: string; seconds: number }[] = [];
	let at = start;
	await page.evaluate((svg) => {
		const cursor = document.createElement('div');
		cursor.id = 'cd-demo-cursor';
		cursor.style.cssText =
			'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;';
		cursor.innerHTML = svg;
		document.body.append(cursor);
	}, CURSOR);
	const place = async (point: Point): Promise<void> => {
		await page.mouse.move(point.x, point.y);
		await page.evaluate(({ x, y }) => {
			const cursor = document.querySelector<HTMLElement>('#cd-demo-cursor');
			if (cursor !== null) {
				cursor.style.transform = `translate(${String(x - 3)}px, ${String(y - 2)}px)`;
			}
		}, point);
		at = point;
	};
	await place(start);
	const frame = async (seconds = STEP_SECONDS): Promise<void> => {
		const file = `frame-${String(shots.length).padStart(4, '0')}.png`;
		await capture(page, join(OUT, 'demo', file));
		shots.push({ file, seconds });
	};
	return {
		frame,
		hold: (seconds) => {
			const last = shots.at(-1);
			if (last !== undefined) {
				last.seconds += seconds;
			}
		},
		moveTo: async (target, steps = 14) => {
			const from = at;
			for (let step = 1; step <= steps; step += 1) {
				const linear = step / steps;
				// Ease in and out, so the pointer starts and lands softly.
				const eased = linear < 0.5 ? 2 * linear * linear : 1 - (-2 * linear + 2) ** 2 / 2;
				await place({
					x: from.x + (target.x - from.x) * eased,
					y: from.y + (target.y - from.y) * eased,
				});
				await frame();
			}
		},
		click: async () => {
			await page.mouse.down();
			await page.mouse.up();
			await settle(page, 200);
			await frame();
		},
		type: async (text) => {
			for (const word of text.match(/\S+\s*/g) ?? []) {
				await page.keyboard.type(word);
				await frame(0.11);
			}
		},
		save: () => {
			// The concat demuxer needs the last file named twice for its duration to count.
			const lines = shots.flatMap(({ file, seconds }) => [
				`file '${file}'`,
				`duration ${seconds.toFixed(3)}`,
			]);
			const last = shots.at(-1);
			writeFileSync(
				join(OUT, 'demo', 'frames.txt'),
				`ffconcat version 1.0\n${[...lines, ...(last === undefined ? [] : [`file '${last.file}'`])].join('\n')}\n`,
			);
		},
	};
};

test.describe('demo', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('comment, copy, agent reply', async ({ page }) => {
		test.setTimeout(240_000);
		rmSync(join(OUT, 'demo'), { recursive: true, force: true });
		mkdirSync(join(OUT, 'demo'), { recursive: true });
		await open(page);
		await fitAll(page);
		const film = await recorder(page, { x: 900, y: 560 });
		await film.frame(1.4);

		// Zoom in on the web page: ctrl+wheel anchors at the pointer, near the frame's top left.
		const home = await frameBox(page, 'home');
		await film.moveTo({ x: home.x + home.width * 0.04, y: home.y + home.height * 0.03 }, 16);
		await page.keyboard.down('Control');
		for (let step = 0; step < 40; step += 1) {
			if (Number.parseInt((await zoomReadout(page).textContent()) ?? '0', 10) >= 84) {
				break;
			}
			await page.mouse.wheel(0, -14);
			await nextAnimationFrame(page);
			await film.frame();
		}
		await page.keyboard.up('Control');
		await settle(page);
		await film.frame(0.5);

		// Comment mode, then pick the long line under the marquee.
		await film.moveTo(centerOf(await boxOf(commentButton(page))));
		await film.click();
		film.hold(0.3);
		const pick = await pointInFrame({
			page,
			frameId: 'home',
			selector: '#hero-line',
			fx: 0.42,
			fy: 0.7,
		});
		await film.moveTo(pick, 18);
		await settle(page);
		await film.frame(0.5);
		await film.click();
		await expect(popover(page)).toBeVisible();
		await film.frame(0.4);
		await film.type('Too wordy. Make it one short line.');
		film.hold(0.6);
		await page.keyboard.press('Enter');
		const created = await lastRequest(page, 'comment:create');
		const box = created.box as { width: number; height: number };
		const point = created.point as Point;
		const saved = await comment(page, {
			id: 'c-demo',
			frameId: 'home',
			selector: String(created.selector),
			tagName: String(created.tagName),
			body: String(created.body),
			pin: { x: point.x / box.width, y: point.y / box.height },
			createdAt: new Date().toISOString(),
		});
		await postToChrome(page, { type: 'comment:added', requestId: String(created.requestId) });
		await postComments(page, [saved]);
		await film.frame(0.9);

		// Open the Comments panel and copy the comment for the agent.
		await film.moveTo(centerOf(await boxOf(panelToggle(page))), 16);
		await film.click();
		await expect(panel(page)).toBeVisible();
		await film.frame(0.6);
		await film.moveTo(centerOf(await boxOf(panelButton(page, 'c-demo', 'Copy for Agent'))), 12);
		await film.click();
		const copied = await lastRequest(page, 'comment:copy');
		await postToChrome(page, { type: 'ui:copied', requestId: String(copied.requestId), count: 1 });
		await postComments(page, [{ ...saved, status: 'sent' }]);
		await film.frame(0.7);
		// Rest on the panel's empty space, clear of the reply that is about to land.
		const card = await boxOf(panelButton(page, 'c-demo', 'Copy for Agent'));
		await film.moveTo({ x: card.x - 40, y: card.y + 260 }, 14);
		film.hold(0.9);

		// The agent's turn: update_artboard reloads the frame, resolve_comment adds its reply.
		await postCanvas(page, frames({ shortLine: true, generation: 4 }));
		await settle(page, 700);
		await film.frame(0.9);
		await postComments(page, [
			{
				...saved,
				status: 'resolved',
				replies: [
					{
						id: 'r-demo',
						author: 'agent',
						body: `Cut it to "${SHORT_LINE}" Saved as version 4.`,
						createdAt: new Date().toISOString(),
					},
				],
			},
		]);
		await film.frame(3);
		film.save();
	});
});
