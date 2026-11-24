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

export type PanelItem = {
	comment: PostedComment;
	number: number;
	badge: PinBadge | undefined;
	frameLabel: string;
	canJump: boolean;
};

// `||`, not `??`: an empty label falls back to the id too.
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

// A zero count is left out, so all zero gives no line.
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

export const commentsText = (count: number): string =>
	count === 1 ? '1 comment' : `${String(count)} comments`;

// `copied`: the copy-open count still showing (undefined = none). Feedback wins and is never drawn
// disabled; a count of 0 is no feedback (it would read as nothing to send). A pending copy blocks
// on top.
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
			hint: "Now paste into your agent's chat.",
			disabled: false,
			copied: true,
		};
	}
	const disabled = open === 0;
	if (open > 0) {
		return {
			label: `Copy ${open === 1 ? '1 open comment' : `${String(open)} open comments`} for Agent`,
			hint: "Then paste into your agent's chat.",
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

// Equal text is not re-announced, so every even sequence ends in a no-break space and a repeat
// still speaks.
export const liveRegionText = ({ text, sequence }: { text: string; sequence: number }): string =>
	sequence % 2 === 0 ? `${text} ` : text;
