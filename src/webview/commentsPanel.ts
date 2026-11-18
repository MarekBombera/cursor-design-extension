import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type { PostedComment } from './hostMessages';
import {
	type AnchorState,
	commentNumber,
	liveAnchor,
	type PinBadge,
	pinBadge,
	statusBadge,
} from './pins';
import type { BadgeTone } from './ui/badge';
import type { IconName } from './ui/icons';

// Comments panel view rules (8g): the items, the summary line, the handoff block, relative times
// and the one live-region rule. Pure: CommentsPanel and CommentCard render what these return.

export type PanelItem = {
	comment: PostedComment;
	// The comment's number (commentNumber), shared with its pin.
	number: number;
	badge: PinBadge | undefined;
	// frameLabel: the drawn frame's label, or the frame id.
	frameLabel: string;
	// The frame is a live iframe, so the stage can jump to it.
	canJump: boolean;
};

// The one rule for a frame's display name: its label, or its id when the frame is absent or its
// label is empty.
export const frameLabel = (frames: readonly FrameRecord[], frameId: string): string =>
	frames.find((frame) => frame.id === frameId)?.label || frameId;

// `comments` is the full comments.json list: it numbers the items.
export const panelItems = ({
	comments,
	anchors,
	frames,
}: {
	comments: readonly PostedComment[];
	anchors: AnchorState;
	frames: readonly FrameRecord[];
}): { unresolved: PanelItem[]; resolved: PanelItem[] } => {
	const liveIds = liveIframeIds(frames);
	const items = comments.map((comment, index): PanelItem => ({
		comment,
		number: commentNumber(index),
		badge: pinBadge({ comment, live: liveAnchor({ anchors, comment }) }),
		frameLabel: frameLabel(frames, comment.frameId),
		canJump: liveIds.has(comment.frameId),
	}));
	return {
		unresolved: items.filter((item) => item.comment.status !== 'resolved'),
		resolved: items.filter((item) => item.comment.status === 'resolved'),
	};
};

export type PanelSummary = Record<PostedComment['status'], number>;

// The comments per status: the panel header's summary and the handoff button. The toolbar's
// unresolved count is open + sent, added up in App.
export const panelSummary = (comments: readonly PostedComment[]): PanelSummary => ({
	open: comments.filter((comment) => comment.status === 'open').length,
	sent: comments.filter((comment) => comment.status === 'sent').length,
	resolved: comments.filter((comment) => comment.status === 'resolved').length,
});

const SUMMARY_WORDS: Record<PostedComment['status'], string> = {
	open: 'to send',
	sent: 'with Agent',
	resolved: 'resolved',
};

// The panel header's summary line, open, sent, resolved: each count with its status icon and tone
// (statusBadge). A zero count is left out, so all zero is an empty list and no line.
export const summaryParts = (
	summary: PanelSummary,
): { text: string; icon: IconName; tone: BadgeTone }[] =>
	(['open', 'sent', 'resolved'] as const)
		.filter((status) => summary[status] > 0)
		.map((status) => ({
			text: `${String(summary[status])} ${SUMMARY_WORDS[status]}`,
			icon: statusBadge(status).icon,
			tone: statusBadge(status).tone,
		}));

// "1 comment" / "N comments": the one count wording, shared with the copy announcements.
export const commentsText = (count: number): string =>
	count === 1 ? '1 comment' : `${String(count)} comments`;

// The panel's handoff block. `copied` is the count of the copy-open answer still showing
// (undefined = no feedback). Feedback wins over everything, but "Copied 0 comments" never shows:
// it reads as nothing to send. `disabled` only at zero open with no feedback showing: the feedback
// is never drawn disabled, and submitCopyOpen ignores a click while it shows. A pending copy blocks
// on top of it.
export const handoffCopy = ({
	open,
	sent,
	copied,
}: {
	open: number;
	sent: number;
	copied?: number;
}): { label: string; hint: string | undefined; disabled: boolean; copied: boolean } => {
	if (copied !== undefined && copied > 0) {
		return {
			label: `Copied ${commentsText(copied)}`,
			hint: 'Now paste into Cursor Agent chat.',
			disabled: false,
			copied: true,
		};
	}
	// A copied count of 0 is no feedback: it never draws an enabled "Nothing new to send".
	const disabled = open === 0;
	if (open > 0) {
		return {
			label: `Copy ${open === 1 ? '1 open comment' : `${String(open)} open comments`} for Agent`,
			hint: 'Then paste into Cursor Agent chat.',
			disabled,
			copied: false,
		};
	}
	const hint =
		sent === 0 ? undefined : `${commentsText(sent)} ${sent === 1 ? 'is' : 'are'} with the Agent.`;
	return { label: 'Nothing new to send', hint, disabled, copied: false };
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// `now` in epoch ms. A future time (clock skew) reads as just now.
export const relativeTime = ({ iso, now }: { iso: string; now: number }): string | undefined => {
	const time = Date.parse(iso);
	if (Number.isNaN(time)) {
		return undefined;
	}
	const elapsed = now - time;
	if (elapsed < MINUTE_MS) {
		return 'just now';
	}
	if (elapsed < HOUR_MS) {
		return relativeFormat.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
	}
	if (elapsed < DAY_MS) {
		return relativeFormat.format(-Math.floor(elapsed / HOUR_MS), 'hour');
	}
	const days = Math.floor(elapsed / DAY_MS);
	if (days < 30) {
		return relativeFormat.format(-days, 'day');
	}
	if (days < 365) {
		return relativeFormat.format(-Math.floor(days / 30), 'month');
	}
	return relativeFormat.format(-Math.floor(days / 365), 'year');
};

// The one alternating live-region rule: equal text is not re-announced, so every even sequence
// ends in a no-break space and a repeat still speaks.
export const liveRegionText = ({ text, sequence }: { text: string; sequence: number }): string =>
	sequence % 2 === 0 ? `${text} ` : text;
