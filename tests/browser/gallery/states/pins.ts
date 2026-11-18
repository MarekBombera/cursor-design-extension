import { boxOf, clickChrome, commentButton, pinOf, zoomSelect } from '../../harness';
import { hoverOver, pointIn, unionOf } from '../interact';
import {
	ago,
	type Definition,
	type Session,
	settle,
	type StateDefinition,
	withComments,
} from '../scene';

export const pinsStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	pinsStates.push(definition);
};

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
