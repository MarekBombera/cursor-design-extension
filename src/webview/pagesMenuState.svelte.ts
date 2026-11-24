import { tick } from 'svelte';

import { postPageRequest } from './hostBridge.svelte';
import type {
	PageRequestMessage,
	PageSavedMessage,
	PostedPage,
	UiErrorMessage,
} from './hostMessages';

type PageRequestType = PageRequestMessage['type'];

export type PageRequest = { requestId: string; type: PageRequestType; pageId?: string };

export type PageRequestError = { type: PageRequestType; pageId?: string; message: string };

const PAGE_BUTTON = '[data-cd-page-button]';
const PAGES_MENU = '[data-cd-pages-menu]';

const renameButton = (pageId: string): string =>
	`${PAGES_MENU} [data-cd-page-rename="${CSS.escape(pageId)}"]`;

const focusFirst = (selectors: string[]): void => {
	for (const selector of selectors) {
		const element = document.querySelector<HTMLElement>(selector);
		if (element !== null) {
			element.focus({ preventScroll: true });
			return;
		}
	}
};

// Inside the page button or the menu (a remount drops focus to body, so body counts too when
// `orBody`).
const focusInMenu = ({ orBody }: { orBody: boolean }): boolean => {
	const active = document.activeElement;
	if (active === null || active === document.body) {
		return orBody;
	}
	return active.closest(`${PAGE_BUTTON}, ${PAGES_MENU}`) !== null;
};

// All page-menu state, owned by App so a page remount (a switch) loses nothing. One request in
// flight at a time; the answer (page:saved or ui:error) arrives before the refresh it causes.
export class PagesMenuState {
	pages: PostedPage[] = $state.raw([]);
	open = $state(false);
	renaming: { pageId: string; draft: string } | undefined = $state();
	request: PageRequest | undefined = $state.raw();
	error: PageRequestError | undefined = $state.raw();
	// Read when the menu opens, for the rows' relative times.
	now = $state(Date.now());

	readonly #stagedPageId: () => string;

	constructor({ stagedPageId }: { stagedPageId: () => string }) {
		this.#stagedPageId = stagedPageId;
	}

	// Every parsed canvas:updated, page change or not.
	setPages = (pages: PostedPage[]): void => {
		this.pages = pages;
	};

	toggle = (): void => {
		if (this.request !== undefined) {
			return;
		}
		if (this.open) {
			this.close();
			return;
		}
		this.open = true;
		this.now = Date.now();
		void this.#focusAfterTick([
			`${PAGES_MENU} [data-cd-page-row][aria-current="page"]`,
			`${PAGES_MENU} [data-cd-page-row]`,
		]);
	};

	// The user closing the menu (Escape focuses the button; an outside pointerdown or focus leaving
	// does not move focus). Ignored while a request is in flight, so the answer has a surface.
	close = ({ focusButton = false }: { focusButton?: boolean } = {}): void => {
		if (this.request !== undefined || !this.open) {
			return;
		}
		this.open = false;
		this.renaming = undefined;
		this.error = undefined;
		if (focusButton) {
			void this.#focusAfterTick([PAGE_BUTTON]);
		}
	};

	// Opening the open page only closes the menu.
	openPage = (pageId: string): void => {
		if (pageId === this.#stagedPageId()) {
			this.close({ focusButton: true });
			return;
		}
		this.#send({ type: 'page:open', requestId: crypto.randomUUID(), pageId });
	};

	createPage = (): void => {
		this.#send({ type: 'page:create', requestId: crypto.randomUUID() });
	};

	startRename = (pageId: string): void => {
		const page = this.pages.find((candidate) => candidate.id === pageId);
		if (this.request !== undefined || page === undefined) {
			return;
		}
		this.renaming = { pageId, draft: page.title };
		this.#clearRenameError();
		void tick().then(() => {
			const input = document.querySelector<HTMLInputElement>(`${PAGES_MENU} input`);
			input?.focus({ preventScroll: true });
			input?.select();
		});
	};

	editRename = (draft: string): void => {
		if (this.renaming === undefined || this.request !== undefined) {
			return;
		}
		this.renaming.draft = draft;
		this.#clearRenameError();
	};

	// The raw draft: the host trims and checks it (parsePageTitle is the one title rule).
	submitRename = (): void => {
		if (this.renaming === undefined) {
			return;
		}
		this.#send({
			type: 'page:rename',
			requestId: crypto.randomUUID(),
			pageId: this.renaming.pageId,
			title: this.renaming.draft,
		});
	};

	// Escape focuses that row's Rename button; a blur only ends the field.
	cancelRename = ({ focusRename = false }: { focusRename?: boolean } = {}): void => {
		const renaming = this.renaming;
		if (renaming === undefined || this.request !== undefined) {
			return;
		}
		this.renaming = undefined;
		this.#clearRenameError();
		if (focusRename) {
			void this.#focusAfterTick([renameButton(renaming.pageId)]);
		}
	};

	// The host asks its native modal; a cancel answers page:saved and writes nothing.
	deletePage = (pageId: string): void => {
		this.#send({ type: 'page:delete', requestId: crypto.randomUUID(), pageId });
	};

	// True when the message answers the request in flight. App never forwards a page:saved, and
	// forwards a ui:error only when this returns false.
	handleAnswer = (message: PageSavedMessage | UiErrorMessage): boolean => {
		const request = this.request;
		if (request === undefined || message.requestId !== request.requestId) {
			return false;
		}
		this.request = undefined;
		// Focus the user moved elsewhere stays there.
		const moveFocus = focusInMenu({ orBody: true });
		if (message.type === 'ui:error') {
			this.error = { type: request.type, pageId: request.pageId, message: message.message };
			if (request.type === 'page:rename' && moveFocus) {
				void this.#focusAfterTick([`${PAGES_MENU} input`]);
			}
			return true;
		}
		if (request.type === 'page:rename') {
			this.renaming = undefined;
			if (moveFocus && request.pageId !== undefined) {
				void this.#focusAfterTick([renameButton(request.pageId), PAGE_BUTTON]);
			}
			return true;
		}
		this.open = false;
		this.renaming = undefined;
		if (moveFocus) {
			void this.#focusAfterTick([PAGE_BUTTON]);
		}
		return true;
	};

	// App's stagePage, before the new page mounts. With a request in flight the menu stays open on
	// the new page, so the answer still lands.
	pageChanged = (): void => {
		this.error = undefined;
		if (this.request === undefined) {
			this.open = false;
			this.renaming = undefined;
		}
	};

	// Read before the old page leaves: the new page's button takes focus only when the old menu
	// held it.
	focusInMenu = (): boolean => focusInMenu({ orBody: false });

	focusButton = (): void => {
		focusFirst([PAGE_BUTTON]);
	};

	#send = (message: PageRequestMessage): void => {
		if (this.request !== undefined) {
			return;
		}
		this.error = undefined;
		this.request = {
			requestId: message.requestId,
			type: message.type,
			...(message.type === 'page:create' ? {} : { pageId: message.pageId }),
		};
		postPageRequest(message);
	};

	#clearRenameError = (): void => {
		if (this.error?.type === 'page:rename') {
			this.error = undefined;
		}
	};

	#focusAfterTick = async (selectors: string[]): Promise<void> => {
		await tick();
		focusFirst(selectors);
	};
}
