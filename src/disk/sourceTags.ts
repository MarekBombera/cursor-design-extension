import { type DefaultTreeAdapterMap, defaultTreeAdapter, html as parse5Html } from 'parse5';

import type { ArtboardDocument, ArtboardElement } from './commentTarget';
import { SOURCE_TAG_ATTRIBUTE } from './layout';

// data-cd-src="N" on the panel's frame copy only, so an edit can name an element and the host can
// find its characters on disk; disk, export and comment selectors never see it.

type TreeNode = DefaultTreeAdapterMap['node'];

// Text-like elements an edit never targets, in every namespace (SVG script, style and title too).
const UNTAGGED_NAMES = new Set(['script', 'style', 'title', 'textarea']);

const TAG_NAME_END = new Set(['\t', '\n', '\f', '\r', ' ', '/', '>']);

// Entry N = every element whose start tag is the Nth distinct start offset. Implied and fake
// elements (stray </p>, </br>) have none; elements rebuilt after misnesting share their tag's
// entry (in walk order). Explicit stack: deep files cannot overflow; template content is skipped.
export const numberedElements = (document: ArtboardDocument): ArtboardElement[][] => {
	const byOffset = new Map<number, ArtboardElement[]>();
	const stack: TreeNode[] = [document];
	for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
		if (defaultTreeAdapter.isElementNode(node)) {
			// SVG text and everything inside it is text content, never an edit target.
			if (node.namespaceURI === parse5Html.NS.SVG && node.tagName === 'text') {
				continue;
			}
			const startOffset = node.sourceCodeLocation?.startTag?.startOffset;
			if (startOffset !== undefined && !UNTAGGED_NAMES.has(node.tagName)) {
				const shared = byOffset.get(startOffset);
				if (shared === undefined) {
					byOffset.set(startOffset, [node]);
				} else {
					shared.push(node);
				}
			}
		}
		// One push per child: a very wide parent cannot hit a spread's argument limit.
		if ('childNodes' in node) {
			for (const child of node.childNodes) {
				stack.push(child);
			}
		}
	}
	return [...byOffset.entries()]
		.sort(([left], [right]) => left - right)
		.map(([, elements]) => elements);
};

// The start offset an entry's elements share; -1 for a missing entry.
export const entryOffset = (entry: ArtboardElement[] | undefined): number =>
	entry?.[0]?.sourceCodeLocation?.startTag?.startOffset ?? -1;

export const tagNameEnd = (html: string, startOffset: number): number => {
	let index = startOffset + 1;
	while (index < html.length && !TAG_NAME_END.has(html.charAt(index))) {
		index += 1;
	}
	return index;
};

// `document` must be parse5's parse of exactly `html` with sourceCodeLocationInfo; any other
// document throws before any output is built, so the caller posts the untagged HTML instead.
// Deleting every inserted ` data-cd-src="N"` gives back `html` byte for byte; the same input
// always gives the same output.
export const sourceTaggedHtml = ({
	html,
	document,
}: {
	html: string;
	document: ArtboardDocument;
}): string => {
	const offsets = numberedElements(document).map(entryOffset);
	for (const offset of offsets) {
		if (offset < 0 || offset >= html.length || html.charAt(offset) !== '<') {
			throw new Error('Source tags: the document was not parsed from this HTML.');
		}
	}
	const parts: string[] = [];
	let copied = 0;
	offsets.forEach((offset, index) => {
		const insertAt = tagNameEnd(html, offset);
		parts.push(html.slice(copied, insertAt), ` ${SOURCE_TAG_ATTRIBUTE}="${index}"`);
		copied = insertAt;
	});
	parts.push(html.slice(copied));
	return parts.join('');
};
