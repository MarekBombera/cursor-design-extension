import { relativeTime } from './commentsPanel';
import type { PageRequestMessage, PostedPage } from './hostMessages';

export type PageRow = {
	id: string;
	title: string;
	time: string | undefined;
	current: boolean;
	canDelete: boolean;
};

// The one page-row rule: the posted list in project.json order. The last page cannot be deleted
// (the host refuses it too, before its modal).
export const pageRows = ({
	pages,
	openPageId,
	now,
}: {
	pages: readonly PostedPage[];
	openPageId: string;
	now: number;
}): PageRow[] =>
	pages.map((page) => ({
		id: page.id,
		title: page.title,
		time: page.updatedAt === null ? undefined : relativeTime({ iso: page.updatedAt, now }),
		current: page.id === openPageId,
		canDelete: pages.length > 1,
	}));

// The one menu focus step. `count` is the rows plus New blank page, the last stop; arrows wrap.
export const nextRowIndex = ({
	key,
	index,
	count,
}: {
	key: string;
	index: number;
	count: number;
}): number | undefined => {
	if (count < 1) {
		return undefined;
	}
	if (key === 'ArrowDown') {
		return (index + 1) % count;
	}
	if (key === 'ArrowUp') {
		return (index - 1 + count) % count;
	}
	if (key === 'Home') {
		return 0;
	}
	if (key === 'End') {
		return count - 1;
	}
	return undefined;
};

// The menu's live region while a request is in flight.
export const PAGE_REQUEST_PENDING_TEXT = {
	'page:open': 'Opening page…',
	'page:create': 'Creating page…',
	'page:rename': 'Renaming page…',
	'page:delete': 'Deleting page…',
} as const satisfies Record<PageRequestMessage['type'], string>;
