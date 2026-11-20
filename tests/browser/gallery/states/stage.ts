import { type PostedCanvasFrame } from '../../../../src/webview/hostMessages';
import { boxOf, canvasUpdated, clickChrome, postToChrome, zoomSelect } from '../../harness';
import { frameGesture, handleOf, labelOf } from '../interact';
import { FRAMES, MOBILE_HTML, type Session, settle, type StateDefinition } from '../scene';

export const stageStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	stageStates.push(definition);
};

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
			hash: 'sha256:test',
			canUndo: false,
			canRedo: false,
			html: MOBILE_HTML,
		}));
		await open({ frames: [...FRAMES, ...extra] });
		await clickChrome(page.getByRole('button', { name: 'Fit all' }));
		await settle(page);
		await shoot();
	},
);
