import type { Comment } from '../disk/commentsFile';
import { COMMENT_STYLE_KEYS, MAX_PICK_TEXT_CHARS, MAX_SELECTOR_CHARS } from '../disk/layout';
import { isSafeStyleValue, toOneLine } from '../webview/frame/frameMessages';

// The Copy prompt / Copy all open prompts, locked word for word (commentPrompt.test.ts pins them):
// never reword a line.

// Every C0/C1 control except the newline the body keeps.
const BODY_CONTROL_CHARS = /[^\P{Cc}\n]/gu;

const promptStyles = (styles: Comment['styles']): string =>
	COMMENT_STYLE_KEYS.flatMap((key) => {
		const value = styles[key];
		return typeof value === 'string' && isSafeStyleValue(value) ? [`${key}: ${value}`] : [];
	}).join('; ');

// Free-text fields go through toOneLine, so frame-sourced text never forges a template line.
// id, frameId and version are filled verbatim: the comments.json parse already validated them.
// ponytail: the body is the user's own text and keeps its newlines, so a hand-edited or cloned
// comments.json can put any words there; the user reads the prompt when pasting it. Upgrade path:
// one-line the body too.
export const singleCommentPrompt = (comment: Comment): string =>
	[
		`Handle cursor-design comment ${comment.id} only.`,
		`First call get_comment("${comment.id}"). If it is resolved, stale or the target is missing, stop and tell me.`,
		`Artboard: ${toOneLine(comment.artboard, MAX_PICK_TEXT_CHARS)} (frame ${comment.frameId}, version ${String(comment.version)})`,
		`Target: ${toOneLine(comment.selector, MAX_SELECTOR_CHARS)} "${toOneLine(comment.text.replaceAll('"', ''), MAX_PICK_TEXT_CHARS)}"`,
		`Current styles: ${promptStyles(comment.styles)}`,
		`Comment: ${comment.body.replace(BODY_CONTROL_CHARS, ' ')}`,
		`Make the change with update_artboard, then call resolve_comment("${comment.id}", note) with a one-line note of what you changed.`,
	].join('\n');

// Callers never pass []: the host answers "no open comments" first. The `{id}` in the last two
// lines is literal text for the Agent, not a placeholder to fill.
export const openCommentsPrompt = (ids: readonly string[]): string =>
	[
		'Handle these cursor-design comments, in this order:',
		...ids.map((id) => `- ${id}`),
		'For each id: first call get_comment("{id}"). If it is resolved, stale or the target is missing, skip it and tell me at the end.',
		'Otherwise make the change with update_artboard, then call resolve_comment("{id}", note) with a one-line note of what you changed.',
	].join('\n');
