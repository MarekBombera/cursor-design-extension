import { commentRequestType, toNewComment, toPostedComment } from './chromeMessages';
import {
	COPIED_NOT_MARKED_MESSAGE,
	NOTHING_OPEN_MESSAGE,
	commentRequestErrorMessage,
	isCopyType,
	malformedRequestMessage,
} from './panelRequestCopy';
import { openCommentsPrompt, singleCommentPrompt } from './commentPrompt';
import { checkedPanelMessage, panelRequest } from './panelRequest';
import {
	addComment,
	getComment,
	listComments,
	markCommentsSent,
	readComments,
	replyToComment,
	setCommentStatus,
} from '../disk/comments';
import { InvalidArgsError, toSafeArtboardErrorMessage } from '../disk/errors';
import { resolveOpenPage, resolveRequestedPage } from '../disk/openPage';
import type { PanelPorts } from '../panel/openArtboardPanel';

// Panel comment handlers; all I/O through ports. Neither export ever rejects.

const READ_FALLBACK_MESSAGE = 'Could not read comments. Check the Output panel: Vibeboard.';

// The last read started wins, so a slow read never overwrites a newer list.
let readGeneration = 0;

export const postPanelComments = async ({ ports }: { ports: PanelPorts }): Promise<void> => {
	const token = ++readGeneration;
	// '' until the resolve succeeds; a read failure after it still names the page.
	let pageId = '';
	// ponytail: no total payload cap; 500 comments × 100 replies × 2000 chars is the ceiling, the
	// same as for canvas:updated. Upgrade path: page the list if a real workspace gets close.
	try {
		const workspaceRoot = ports.workspaceRoot();
		if (!ports.isTrusted() || workspaceRoot === undefined) {
			ports.postComments({ pageId, comments: [] });
			return;
		}
		const page = await resolveOpenPage({ workspaceRoot, createIfFresh: false });
		pageId = page.pageId;
		const comments = await readComments({ page });
		if (token === readGeneration) {
			ports.postComments({ pageId, comments: comments.map(toPostedComment) });
		}
	} catch (error: unknown) {
		ports.log('panelComments.read', error);
		if (token === readGeneration) {
			ports.postComments({
				pageId,
				comments: [],
				error: toSafeArtboardErrorMessage(error, READ_FALLBACK_MESSAGE),
			});
		}
	}
};

const LOG_SCOPES = {
	'comment:create': 'panelComments.create',
	'comment:reply': 'panelComments.reply',
	'comment:set-status': 'panelComments.setStatus',
	'comment:copy': 'panelComments.copy',
	'comment:copy-open': 'panelComments.copyOpen',
} as const;

// Answered exactly once unless it has no usable requestId. The disk writes take
// withWorkspaceLock themselves: never wrap them.
// Copy: clipboard first, then markCommentsSent, so a failed write marks nothing sent; every copy
// answer, success or error, is followed by a refresh (a stale Copy all open count corrects itself).
// ponytail: getComment / listComments compute flags the prompt never uses, bounded by the 200 ms
// check budget and the parse cache. Upgrade path: a flag-free disk read.
export const answerCommentRequest = async ({
	value,
	ports,
}: {
	value: unknown;
	ports: PanelPorts;
}): Promise<void> => {
	const type = commentRequestType(value);
	if (type === undefined) {
		// Routing only calls this for a claimed type, so there is nothing to answer to.
		ports.log(
			'panelComments.answer',
			new InvalidArgsError('Comment request from the panel claims no known type.'),
		);
		return;
	}
	const request = panelRequest({
		value,
		type,
		scope: LOG_SCOPES[type],
		ports,
		afterRefuse: isCopyType(type)
			? () => {
					void postPanelComments({ ports });
				}
			: undefined,
	});
	if (request === undefined) {
		return;
	}
	const { requestId, refuse } = request;
	try {
		const checked = checkedPanelMessage({
			value,
			type,
			malformedMessage: malformedRequestMessage(type),
			refuse,
			ports,
		});
		if (checked === undefined) {
			return;
		}
		const { workspaceRoot, message } = checked;
		const page = await resolveRequestedPage({ workspaceRoot, pageId: message.pageId });
		// The clipboard already holds the prompt here, so any throw gets its own copy; the typed
		// message is only logged. Undefined: refused, stop.
		const markSent = async (ids: readonly string[]): Promise<number | undefined> => {
			try {
				return (await markCommentsSent({ page, ids })).length;
			} catch (error: unknown) {
				refuse(COPIED_NOT_MARKED_MESSAGE, error);
				return undefined;
			}
		};
		// Exhaustive on purpose: a new comment request type fails to compile here until it is
		// handled and answered.
		switch (message.type) {
			case 'comment:create':
				await addComment({ page, comment: toNewComment(message) });
				ports.postAnswer({ type: 'comment:added', requestId });
				break;
			case 'comment:reply':
				await replyToComment({ page, id: message.id, body: message.body });
				ports.postAnswer({ type: 'comment:saved', requestId });
				break;
			case 'comment:set-status':
				await setCommentStatus({ page, id: message.id, status: message.status });
				ports.postAnswer({ type: 'comment:saved', requestId });
				break;
			case 'comment:copy': {
				const comment = await getComment({ page, id: message.id });
				await ports.writeClipboard(singleCommentPrompt(comment));
				const count = await markSent([comment.id]);
				if (count === undefined) {
					return;
				}
				ports.postAnswer({ type: 'ui:copied', requestId, count });
				break;
			}
			case 'comment:copy-open': {
				const { comments } = await listComments({ page, status: 'open' });
				if (comments.length === 0) {
					refuse(
						NOTHING_OPEN_MESSAGE,
						new InvalidArgsError('Copy all open with no open comments on disk.'),
					);
					return;
				}
				const ids = comments.map((comment) => comment.id);
				await ports.writeClipboard(openCommentsPrompt(ids));
				const count = await markSent(ids);
				if (count === undefined) {
					return;
				}
				ports.postAnswer({ type: 'ui:copied', requestId, count });
				break;
			}
			default:
				return message satisfies never;
		}
		void postPanelComments({ ports });
	} catch (error: unknown) {
		refuse(commentRequestErrorMessage({ type, error }), error);
	}
};
