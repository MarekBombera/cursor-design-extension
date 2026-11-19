import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DefaultTreeAdapterMap, defaultTreeAdapter } from 'parse5';
import { test } from 'vite-plus/test';

import { parseArtboardDocument } from './commentTarget';
import { SOURCE_TAG_ATTRIBUTE } from './layout';
import { numberedElements, sourceTaggedHtml } from './sourceTags';

const tagged = (html: string): string =>
	sourceTaggedHtml({ html, document: parseArtboardDocument(html) });

const stripped = (html: string): string => html.replaceAll(/ data-cd-src="\d+"/g, '');

// [startOffset, value] for every element of a parse5 re-parse that carries the attribute.
const taggedElements = (html: string): [number, string][] => {
	const found: [number, string][] = [];
	const stack: DefaultTreeAdapterMap['node'][] = [parseArtboardDocument(html)];
	for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
		if (defaultTreeAdapter.isElementNode(node)) {
			const value = node.attrs.find((attr) => attr.name === SOURCE_TAG_ATTRIBUTE)?.value;
			const offset = node.sourceCodeLocation?.startTag?.startOffset;
			if (value !== undefined && offset !== undefined) {
				found.push([offset, value]);
			}
		}
		if ('childNodes' in node) {
			for (const child of node.childNodes) {
				stack.push(child);
			}
		}
	}
	return found;
};

test('every element with a start tag is numbered in source order; title is not', () => {
	assert.equal(
		tagged(
			'<!doctype html><html><head><title>t</title></head><body><div><p>a</p></div></body></html>',
		),
		'<!doctype html><html data-cd-src="0"><head data-cd-src="1"><title>t</title></head><body data-cd-src="2"><div data-cd-src="3"><p data-cd-src="4">a</p></div></body></html>',
	);
	assert.equal(tagged('<p>a</p>'), '<p data-cd-src="0">a</p>');
});

test('implied elements and fake elements for stray end tags get nothing', () => {
	assert.equal(
		tagged('<table><tr><td>x</td></tr></table>'),
		'<table data-cd-src="0"><tr data-cd-src="1"><td data-cd-src="2">x</td></tr></table>',
	);
	assert.equal(tagged('<p>a</br></p>'), '<p data-cd-src="0">a</br></p>');
	assert.equal(tagged('<div></p></div>'), '<div data-cd-src="0"></p></div>');
});

test('a reconstructed formatting element shares one insertion and one number', () => {
	const output = tagged('<p><b>x</p><p>y</p>');
	assert.equal(output, '<p data-cd-src="0"><b data-cd-src="1">x</p><p data-cd-src="2">y</p>');
	const bolds = taggedElements(output).filter(([offset]) => output.startsWith('<b', offset));
	// Both b elements of the re-parse come from the one tagged start tag.
	assert.deepEqual(bolds, [
		[19, '1'],
		[19, '1'],
	]);
});

test('numberedElements shares one entry between a reconstructed element and its source', () => {
	const html = '<p><b>x</p><p>y</p>';
	const entries = numberedElements(parseArtboardDocument(html));
	assert.deepEqual(
		entries.map((entry) => entry.map((element) => element.tagName)),
		[['p'], ['b', 'b'], ['p']],
	);
	assert.equal(entries[1]?.[0]?.sourceCodeLocation?.startTag?.startOffset, 3);
	assert.equal(tagged(html), '<p data-cd-src="0"><b data-cd-src="1">x</p><p data-cd-src="2">y</p>');
});

test('script, style, textarea and title, and markup in their raw text, stay untouched', () => {
	assert.equal(
		tagged(
			'<title><div></title><style><div></style><script><div></div></script><p>a</p><textarea><div></textarea>',
		),
		'<title><div></title><style><div></style><script><div></div></script><p data-cd-src="0">a</p><textarea><div></textarea>',
	);
});

test('a template is numbered, its content is not', () => {
	assert.equal(
		tagged('<template><div>x</div></template>'),
		'<template data-cd-src="0"><div>x</div></template>',
	);
});

test('SVG style, and SVG text with its subtree, get nothing', () => {
	assert.equal(
		tagged('<svg><rect/><style>r{}</style><text>hi<tspan>x</tspan></text></svg>'),
		'<svg data-cd-src="0"><rect data-cd-src="1"/><style>r{}</style><text>hi<tspan>x</tspan></text></svg>',
	);
});

test('the attribute goes right after the tag name, before an existing data-cd-src', () => {
	assert.equal(
		tagged('<DIV><br/><input\n  type=text><p data-cd-src="99">x</p></DIV>'),
		'<DIV data-cd-src="0"><br data-cd-src="1"/><input data-cd-src="2"\n  type=text><p data-cd-src="3" data-cd-src="99">x</p></DIV>',
	);
	// Every HTML white-space character ends a tag name, not only space and newline.
	assert.equal(
		tagged('<p\tid=a>x</p><p\fid=b>y</p><p\rid=c>z</p>'),
		'<p data-cd-src="0"\tid=a>x</p><p data-cd-src="1"\fid=b>y</p><p data-cd-src="2"\rid=c>z</p>',
	);
});

test('offsets are UTF-16 indices: a BOM, an emoji and CRLF do not shift insertions', () => {
	assert.equal(
		tagged('\uFEFF😀<p>a</p>\r\n<div>b</div>\r\n'),
		'\uFEFF😀<p data-cd-src="0">a</p>\r\n<div data-cd-src="1">b</div>\r\n',
	);
});

test('real fixtures: strip round-trip, stable output and contiguous numbers', () => {
	const galleryDir = join(process.cwd(), 'fixtures/gallery');
	const paths = [
		join(process.cwd(), 'fixtures/picking.html'),
		...readdirSync(galleryDir)
			.filter((name) => name.endsWith('.html'))
			.map((name) => join(galleryDir, name)),
	];
	for (const path of paths) {
		const html = readFileSync(path, 'utf8');
		assert.equal(html.includes(SOURCE_TAG_ATTRIBUTE), false, path);
		const output = tagged(html);
		assert.equal(stripped(output), html, path);
		assert.equal(tagged(html), output, path);
		const offsets = new Set<number>();
		const values: number[] = [];
		for (const [offset, value] of taggedElements(output).sort(([left], [right]) => left - right)) {
			if (!offsets.has(offset)) {
				offsets.add(offset);
				values.push(Number(value));
			}
		}
		assert.ok(values.length > 0, path);
		assert.deepEqual(
			values,
			values.map((_, index) => index),
			path,
		);
	}
});

test('empty HTML returns empty', () => {
	assert.equal(tagged(''), '');
});

test('20,000 nested divs neither overflow the stack nor break the round-trip', () => {
	const html = `${'<div>'.repeat(20_000)}x${'</div>'.repeat(20_000)}`;
	assert.equal(stripped(tagged(html)), html);
});

test('a document parsed from other HTML throws instead of corrupting the copy', () => {
	const longer =
		'<!doctype html><html><head><title>t</title></head><body><div><p>a</p></div></body></html>';
	assert.throws(() =>
		sourceTaggedHtml({ html: '<p>a</p>', document: parseArtboardDocument(longer) }),
	);
	assert.throws(() =>
		sourceTaggedHtml({ html: '<p>abcdef</p>', document: parseArtboardDocument('ab<p>x</p>') }),
	);
});
