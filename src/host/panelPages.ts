import { pageRequestType } from './chromeMessages';
import { forgetPageHistories } from './editHistory';
import { checkedPanelMessage, panelRequest } from './panelRequest';
import { MALFORMED_PAGE_REQUEST_MESSAGE, pageRequestErrorMessage } from './panelRequestCopy';
import { refreshPanel } from './refreshPanel';
import { InvalidArgsError } from '../disk/errors';
import { readProjectFile } from '../disk/layoutFs';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, deletePage, listedPage, openPage, renamePage } from '../disk/pageOps';
import type { PanelPorts } from '../panel/openArtboardPanel';

// Panel page handler; all I/O through ports. Never rejects.

const LOG_SCOPES = {
	'page:open': 'panelPages.open',
	'page:create': 'panelPages.create',
	'page:rename': 'panelPages.rename',
	'page:delete': 'panelPages.delete',
} as const;

// A cancelled modal returns with nothing written (the caller answers page:saved). The last-page
// check runs before the modal so it never asks for a delete that must fail; deletePage re-checks it under the lock.
const confirmAndDeletePage = async ({
	workspaceRoot,
	pageId,
	ports,
}: {
	workspaceRoot: string;
	pageId: string;
	ports: PanelPorts;
}): Promise<void> => {
	const { project, entry } = listedPage(await readProjectFile(workspaceRoot), pageId);
	if (project.pages.length === 1) {
		throw new InvalidArgsError('The last page cannot be deleted.');
	}
	const confirmed = await ports.confirmModal({
		message: `Delete "${entry.title}"?`,
		detail: 'Its files move to .vibeboard/deleted/.',
		action: 'Delete',
	});
	if (!confirmed) {
		return;
	}
	await deletePage({ workspaceRoot, pageId, now: new Date() });
	forgetPageHistories(pageId);
};

// Answered exactly once (page:saved, a cancelled delete included, or ui:error) unless it has no
// usable requestId; every answer is followed by a refresh, so the list and stage catch up without
// waiting on the watcher. One resolve here covers renamePage and deletePage (they never resolve);
// createPage and openPage resolve again inside by contract, lock-free after this one.
export const answerPageRequest = async ({
	value,
	ports,
}: {
	value: unknown;
	ports: PanelPorts;
}): Promise<void> => {
	const type = pageRequestType(value);
	// Routing only calls this for a claimed type, so there is nothing to answer to.
	if (type === undefined) {
		ports.log(
			'panelPages.answer',
			new InvalidArgsError('Page request from the panel has no valid requestId.'),
		);
		return;
	}
	const request = panelRequest({
		value,
		type,
		scope: LOG_SCOPES[type],
		ports,
		afterRefuse: () => {
			void refreshPanel({ ports });
		},
	});
	if (request === undefined) {
		return;
	}
	const { requestId, refuse } = request;
	try {
		const checked = checkedPanelMessage({
			value,
			type,
			malformedMessage: MALFORMED_PAGE_REQUEST_MESSAGE,
			refuse,
			ports,
		});
		if (checked === undefined) {
			return;
		}
		const { workspaceRoot, message } = checked;
		await resolveOpenPage({ workspaceRoot, createIfFresh: false });
		// Exhaustive on purpose: a new page request type fails to compile here until it is handled.
		switch (message.type) {
			case 'page:open':
				await openPage({ workspaceRoot, pageId: message.pageId });
				break;
			case 'page:create':
				await createPage({ workspaceRoot, writeEnsurePanelMarker: false });
				break;
			case 'page:rename':
				await renamePage({ workspaceRoot, pageId: message.pageId, title: message.title });
				break;
			case 'page:delete':
				await confirmAndDeletePage({ workspaceRoot, pageId: message.pageId, ports });
				break;
			default:
				return message satisfies never;
		}
		ports.postAnswer({ type: 'page:saved', requestId });
		void refreshPanel({ ports });
	} catch (error: unknown) {
		refuse(pageRequestErrorMessage({ type, error }), error);
	}
};
