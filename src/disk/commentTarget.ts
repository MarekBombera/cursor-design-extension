import { selectAll } from 'css-select';
import { parse, serializeOuter } from 'parse5';
import { adapter, type Htmlparser2TreeAdapterMap } from 'parse5-htmlparser2-tree-adapter';

import { hashHtml } from './hash';

export const parseArtboardDocument = (
	html: string,
): ReturnType<typeof parse<Htmlparser2TreeAdapterMap>> => parse(html, { treeAdapter: adapter });

export type ArtboardDocument = ReturnType<typeof parseArtboardDocument>;

type ArtboardNode = Parameters<typeof adapter.isElementNode>[0];
type ArtboardParent = Parameters<typeof adapter.getChildNodes>[0];
type ArtboardElement = Parameters<typeof adapter.getTagName>[0];

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

export const HINT_FRAME_MISSING = "The frame's artboard no longer exists.";

export const HINT_FRAME_UNREADABLE = "The frame's artboard file cannot be read.";

export const HINT_UNCHECKED =
	'The target is generated or changed by script; it cannot be checked from disk.';

export const HINT_NO_SINGLE_MATCH = 'The selector now matches no element or several elements.';

export const HINT_CONTAINER =
	'The target contains other elements; edits inside it (including fixes for nested comments) mark it stale.';

// Only what buildSelector (@medv/finder, or its nth-of-type fallback) emits is matched: compounds of
// a tag, #id, .class, [attr="value"] (CSS.escape'd idents), :nth-child(n) and :nth-of-type(n),
// joined by " > " or one space. Anything else is unchecked, never run. The selector comes from a
// hand-editable comments.json today and a forgeable cd:pick from 8f1, and both this regex and
// css-select run synchronously in the MCP queue, so both must stay bounded:
// - IDENT's alternatives start with disjoint characters (word, backslash, non-ASCII), so the
//   regex is linear. A CSS hex escape's optional trailing space reads as a descendant step, which
//   only makes the cap below stricter.
// - css-select backtracks once per descendant combinator per ancestor: cost grows like
//   depth^(descendants + 1) per deep element (p div div div: 87 ms at depth 100, 14 s at 400).
//   Child chains stay linear. So at most MAX_DESCENDANT_COMBINATORS descendant steps, on
//   documents at most MAX_CHECKED_DEPTH deep, MAX_CHECKED_ELEMENTS large and MAX_CHECKED_SIBLINGS
//   wide. Measured worst cases at the caps: p div div with every element 64 deep, 207 ms on
//   19,200 elements; li:nth-child(3) on 5,000 siblings, 54 ms.
// ponytail: a longer finder path, or a deeper, larger or wider page, reads as unchecked (null
// flags) rather than checked; at the caps one distinct selector still costs up to ~0.2 s.
// Upgrade path: a match budget inside css-select.
const IDENT = String.raw`(?:[\w-]|\\.|[^\x00-\x7F])+`;
const SIMPLE = String.raw`(?:#${IDENT}|\.${IDENT}|\[${IDENT}="(?:[^"\\]|\\.)*"\]|:nth-(?:child|of-type)\(\d+\))`;
const COMPOUND = String.raw`(?:${IDENT}${SIMPLE}*|${SIMPLE}+)`;
const FINDER_SELECTOR = new RegExp(String.raw`^${COMPOUND}(?:(?: > | )${COMPOUND})*$`);
const COMBINATOR_STEP = new RegExp(String.raw`${COMPOUND}( > | )?`, 'g');

const MAX_DESCENDANT_COMBINATORS = 2;

const MAX_CHECKED_DEPTH = 64;

// :nth-child / :nth-of-type rescan the siblings of every candidate, so css-select is quadratic in
// sibling count (li:nth-child(3): 54 ms at 5k siblings, 2.2 s at 20k); total size bounds the rest.
const MAX_CHECKED_ELEMENTS = 20_000;

const MAX_CHECKED_SIBLINGS = 5000;

const isCheckableSelector = (selector: string): boolean => {
	if (!FINDER_SELECTOR.test(selector)) {
		return false;
	}
	let descendants = 0;
	for (const [, combinator] of selector.matchAll(COMBINATOR_STEP)) {
		if (combinator === ' ') {
			descendants += 1;
		}
	}
	return descendants <= MAX_DESCENDANT_COMBINATORS;
};

// One walk per parsed document (iterative: deep pages are the point), cached by document.
type DocumentShape = { depth: number; elements: number; widest: number };

const shapeByDocument = new WeakMap<ArtboardDocument, DocumentShape>();

const documentShape = (document: ArtboardDocument): DocumentShape => {
	const cached = shapeByDocument.get(document);
	if (cached !== undefined) {
		return cached;
	}
	const shape: DocumentShape = { depth: 0, elements: 0, widest: 0 };
	const stack: { node: ArtboardParent; depth: number }[] = [{ node: document, depth: 0 }];
	for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
		shape.depth = Math.max(shape.depth, entry.depth);
		let children = 0;
		for (const child of adapter.getChildNodes(entry.node)) {
			if (adapter.isElementNode(child)) {
				children += 1;
				stack.push({ node: child, depth: entry.depth + 1 });
			}
		}
		shape.elements += children;
		shape.widest = Math.max(shape.widest, children);
	}
	shapeByDocument.set(document, shape);
	return shape;
};

const isCheckableDocument = (document: ArtboardDocument): boolean => {
	const { depth, elements, widest } = documentShape(document);
	return (
		depth <= MAX_CHECKED_DEPTH && elements <= MAX_CHECKED_ELEMENTS && widest <= MAX_CHECKED_SIBLINGS
	);
};

const collectedText = (node: ArtboardParent): string => {
	let text = '';
	for (const child of adapter.getChildNodes(node)) {
		if (adapter.isTextNode(child)) {
			text += adapter.getTextNodeContent(child);
			continue;
		}
		if (adapter.isElementNode(child)) {
			text += collectedText(child);
		}
	}
	return text;
};

const hasElementChild = (node: ArtboardParent): boolean =>
	adapter.getChildNodes(node).some((child: ArtboardNode) => adapter.isElementNode(child));

const normalizeOuterHtml = (html: string): string =>
	html.replace(/\s+/g, ' ').replace(/> /g, '>').replace(/ </g, '<').trim();

const fingerprintOf = (element: ArtboardElement): string =>
	hashHtml(normalizeOuterHtml(serializeOuter(element, { treeAdapter: adapter })));

// One css-select pass per distinct selector per parsed document: comments that share a target
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

const runCommentMatch = (document: ArtboardDocument, selector: string): CommentMatch => {
	if (!isCheckableSelector(selector) || !isCheckableDocument(document)) {
		return { checkable: false };
	}
	let matches: ArtboardElement[];
	try {
		matches = selectAll<ArtboardNode, ArtboardElement>(selector, document);
	} catch {
		return { checkable: false };
	}
	if (matches.length !== 1) {
		return { checkable: true, matches: matches.length };
	}
	const [match] = matches;
	if (match === undefined) {
		return { checkable: true, matches: 0 };
	}
	return {
		checkable: true,
		matches: 1,
		tagName: adapter.getTagName(match).toLowerCase(),
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
