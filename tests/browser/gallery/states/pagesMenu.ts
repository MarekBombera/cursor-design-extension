import { expect, type Page } from '@playwright/test';
import type { PostedPage } from '../../../../src/webview/hostMessages';
import {
	boxOf,
	clickChrome,
	lastRequest,
	pageButton,
	pagesMenu,
	postToChrome,
} from '../../harness';
import { unionOf } from '../interact';
import { ago, type Session, settle, type StateDefinition } from '../scene';

export const pagesMenuStates: StateDefinition[] = [];

const LONG_TITLE =
	'Checkout flow, second pass with the reviewed copy, the new address form and the trust badges';

const page = (index: number, title: string, updatedAt: string | null): PostedPage => ({
	id: `page-${index}`,
	title,
	updatedAt,
});

const FEW: PostedPage[] = [
	page(1, 'Home', ago(12)),
	page(2, 'Pricing', ago(60 * 3)),
	page(3, 'Checkout', ago(60 * 24 * 2)),
];

const MANY: PostedPage[] = [
	page(1, 'Home', ago(0)),
	page(2, 'Pricing', null),
	...Array.from({ length: 22 }, (_, index) =>
		page(index + 3, `Exploration ${index + 1}`, ago(7 + index * 97)),
	),
];

const openMenu = async (browserPage: Page): Promise<void> => {
	await clickChrome(pageButton(browserPage));
	await expect(pagesMenu(browserPage)).toBeVisible();
};

// The button and the menu under it.
const shootMenu = async ({ page: browserPage, shoot }: Session): Promise<void> => {
	await settle(browserPage);
	await shoot({
		closeup: unionOf([await boxOf(pageButton(browserPage)), await boxOf(pagesMenu(browserPage))]),
	});
};

const pagesMenuState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
	notes?: string[],
): void => {
	pagesMenuStates.push({ surface: 'pages-menu', state, setup, notes, run });
};

pagesMenuState(
	'one-page',
	'One page listed; opened the Pages menu. Delete is disabled (the last page cannot be deleted).',
	async (session) => {
		await session.open({ pages: [page(1, 'Page 1', ago(4))] });
		await openMenu(session.page);
		await shootMenu(session);
	},
);
pagesMenuState(
	'many-pages',
	'24 pages, the open one edited just now, Pricing with no readable time; the list scrolls.',
	async (session) => {
		await session.open({ pages: MANY });
		await openMenu(session.page);
		await shootMenu(session);
	},
);
pagesMenuState(
	'long-title',
	'The open page and one row have long titles: the button and the row end in an ellipsis.',
	async (session) => {
		await session.open({ pages: [page(1, LONG_TITLE, ago(30)), ...FEW.slice(1)] });
		await openMenu(session.page);
		await shootMenu(session);
	},
);
pagesMenuState(
	'rename-field',
	'Clicked Rename on Pricing: its title became a selected text field.',
	async (session) => {
		await session.open({ pages: FEW });
		await openMenu(session.page);
		await clickChrome(session.page.locator('[data-cd-page-rename="page-2"]'));
		await expect(pagesMenu(session.page).getByRole('textbox')).toBeFocused();
		await shootMenu(session);
	},
);
pagesMenuState(
	'rename-error',
	'Renamed Pricing to spaces only; the host answered ui:error with the title rule.',
	async (session) => {
		await session.open({ pages: FEW });
		await openMenu(session.page);
		await clickChrome(session.page.locator('[data-cd-page-rename="page-2"]'));
		await session.page.keyboard.type('   ');
		await session.page.keyboard.press('Enter');
		const request = await lastRequest(session.page, 'page:rename');
		await postToChrome(session.page, {
			type: 'ui:error',
			requestId: String(request.requestId),
			message: 'A page title needs 1 to 80 characters and no control characters.',
		});
		await expect(pagesMenu(session.page).getByRole('alert')).toBeVisible();
		await shootMenu(session);
	},
);
pagesMenuState(
	'request-in-flight',
	'Clicked New blank page; no answer yet: every menu control and the page button are aria-disabled.',
	async (session) => {
		await session.open({ pages: FEW });
		await openMenu(session.page);
		await clickChrome(session.page.locator('[data-cd-page-new]'));
		await lastRequest(session.page, 'page:create');
		await session.page.mouse.move(640, 600);
		await shootMenu(session);
	},
	['The live region says "Creating page…" (visually hidden).'],
);
