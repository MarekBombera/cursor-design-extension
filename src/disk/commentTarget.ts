import { type DefaultTreeAdapterMap, defaultTreeAdapter, parse, serializeOuter } from 'parse5';

import { hashHtml } from './hash';
import { selectMatches } from './selectorMatch';

// With source locations, read by source tags and the edit core; serializeOuter ignores them, so
// fingerprints are unchanged.
// ponytail: one parse config, so comment reads (the MCP process, addComment's uncached check) pay
// about 1.7x parse time and 1.8x memory for offsets they never read. Upgrade path: a locations
// flag for source tags and the edit core, keyed into the commentViews cache.
export const parseArtboardDocument = (html: string): DefaultTreeAdapterMap['document'] =>
	parse(html, { sourceCodeLocationInfo: true });

export type ArtboardDocument = ReturnType<typeof parseArtboardDocument>;

type ArtboardNode = DefaultTreeAdapterMap['childNode'];
export type ArtboardElement = DefaultTreeAdapterMap['element'];

export type CommentMatch =
	| { checkable: false }
	| {
			checkable: true;
			matches: number;
			tagName?: string;
			text?: string;
			fingerprint?: string;
			hasElementChildren?: boolean;
	  };

export type FlagTarget = {
	isPage: boolean;
	targetFingerprint?: string;
	selector: string;
};

// What a flags check knows about the frame's HTML: parsed, known to exist without being parsed
// (page comments and comments with no fingerprint never need the tree), gone, or unreadable.
export type CommentDocument = ArtboardDocument | 'present' | 'missing' | 'unreadable';

export type CommentFlags = {
	stale: boolean | null;
	targetMissing: boolean | null;
	hint?: string;
};

const HINT_FRAME_MISSING = "The frame's artboard no longer exists.";

const HINT_FRAME_UNREADABLE = "The frame's artboard file cannot be read.";

const HINT_UNCHECKED =
	'The target is generated or changed by script; it cannot be checked from disk.';

const HINT_NO_SINGLE_MATCH = 'The selector now matches no element or several elements.';

export const HINT_CHECK_BUDGET =
	'Too many comments to check at once; read again to check this one.';

const HINT_CONTAINER =
	'The target contains other elements; edits inside it (including fixes for nested comments) mark it stale.';

// Text in document order, walked with an explicit stack and pushed one child at a time: a deep
// or very wide target can overflow neither the call stack nor a spread's argument limit. A
// template's content is not among its childNodes, so it never counts (as in the browser).
const collectedText = (element: ArtboardElement): string => {
	let text = '';
	const stack: ArtboardNode[] = [element];
	for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
		if (defaultTreeAdapter.isTextNode(node)) {
			text += node.value;
		} else if (defaultTreeAdapter.isElementNode(node)) {
			for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
				const child = node.childNodes[index];
				if (child !== undefined) {
					stack.push(child);
				}
			}
		}
	}
	return text;
};

const hasElementChild = (element: ArtboardElement): boolean =>
	element.childNodes.some((child) => defaultTreeAdapter.isElementNode(child));

const normalizeOuterHtml = (html: string): string =>
	html.replace(/\s+/g, ' ').replace(/> /g, '>').replace(/ </g, '<').trim();

const fingerprintOf = (element: ArtboardElement): string =>
	hashHtml(normalizeOuterHtml(serializeOuter(element)));

// One match per distinct selector per parsed document: comments that share a target
// (list_comments over many comments on one frame) reuse the first match.
const matchesByDocument = new WeakMap<ArtboardDocument, Map<string, CommentMatch>>();

export const matchCommentTarget = ({
	document,
	selector,
}: {
	document: ArtboardDocument;
	selector: string;
}): CommentMatch => {
	let cache = matchesByDocument.get(document);
	if (cache === undefined) {
		cache = new Map();
		matchesByDocument.set(document, cache);
	}
	const cached = cache.get(selector);
	if (cached !== undefined) {
		return cached;
	}
	const match = runCommentMatch(document, selector);
	cache.set(selector, match);
	return match;
};

// selectMatches never throws (property-tested), so there is no catch here: a throw is a bug and
// fails the read loudly. null = outside the finder grammar or past MAX_MATCH_WORK.
const runCommentMatch = (document: ArtboardDocument, selector: string): CommentMatch => {
	const matches = selectMatches(document, selector);
	if (matches === null) {
		return { checkable: false };
	}
	const [match] = matches;
	if (matches.length !== 1 || match === undefined) {
		return { checkable: true, matches: matches.length };
	}
	return {
		checkable: true,
		matches: 1,
		tagName: match.tagName.toLowerCase(),
		text: collectedText(match),
		fingerprint: fingerprintOf(match),
		hasElementChildren: hasElementChild(match),
	};
};

const normText = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

export const targetAgrees = ({
	match,
	tagName,
	text,
}: {
	match: CommentMatch;
	tagName: string;
	text: string;
}): boolean =>
	match.checkable &&
	match.matches === 1 &&
	match.tagName === tagName &&
	normText(match.text ?? '').startsWith(normText(text));

export const commentFlags = ({
	target,
	document,
}: {
	target: FlagTarget;
	document: CommentDocument;
}): CommentFlags => {
	if (target.isPage && document === 'missing') {
		return { stale: false, targetMissing: true, hint: HINT_FRAME_MISSING };
	}
	if (target.isPage && document === 'unreadable') {
		return { stale: null, targetMissing: null, hint: HINT_FRAME_UNREADABLE };
	}
	if (target.isPage) {
		return { stale: false, targetMissing: false };
	}
	if (document === 'missing') {
		return { stale: null, targetMissing: true, hint: HINT_FRAME_MISSING };
	}
	if (document === 'unreadable') {
		return { stale: null, targetMissing: null, hint: HINT_FRAME_UNREADABLE };
	}
	if (target.targetFingerprint === undefined) {
		return { stale: null, targetMissing: null, hint: HINT_UNCHECKED };
	}
	if (document === 'present') {
		// A fingerprinted element comment always gets a parsed document; reaching here is a caller
		// bug, so report unchecked rather than guess.
		return { stale: null, targetMissing: null, hint: HINT_UNCHECKED };
	}
	const match = matchCommentTarget({ document, selector: target.selector });
	if (!match.checkable) {
		return { stale: null, targetMissing: null, hint: HINT_UNCHECKED };
	}
	if (match.matches !== 1) {
		return { stale: null, targetMissing: true, hint: HINT_NO_SINGLE_MATCH };
	}
	const flags: CommentFlags = {
		stale: match.fingerprint !== target.targetFingerprint,
		targetMissing: false,
	};
	if (match.hasElementChildren === true) {
		flags.hint = HINT_CONTAINER;
	}
	return flags;
};
