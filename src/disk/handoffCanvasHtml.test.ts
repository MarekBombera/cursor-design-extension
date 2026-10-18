import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	type CanvasPreviewFrame,
	buildCanvasPreviewHtml,
	buildPreviewFrameHtml,
} from './handoffCanvasHtml';
import { ARTBOARD_CANVAS_RUNTIME_SOURCE } from '../panel/artboardCanvasRuntime';

const decodeAttribute = (value: string): string =>
	value
		.replaceAll('&#39;', "'")
		.replaceAll('&quot;', '"')
		.replaceAll('&gt;', '>')
		.replaceAll('&lt;', '<')
		.replaceAll('&amp;', '&');

const frame = (overrides: Partial<CanvasPreviewFrame> & { id: string }): CanvasPreviewFrame => ({
	label: overrides.id,
	x: 0,
	y: 0,
	width: 400,
	folder: 'ungrouped',
	html: '<p>frame</p>',
	...overrides,
});

const iframeTags = (html: string): string[] => html.match(/<iframe [^>]*>/g) ?? [];

const attributeOf = (tag: string, name: string): string | undefined =>
	new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];

const styleNumber = (tag: string, property: string): number => {
	const match = new RegExp(`${property}:(-?[0-9.]+)px`).exec(tag);
	assert.ok(match !== null, `${property} in ${tag.slice(0, 80)}`);
	return Number(match[1]);
};

const runtimeBlock = (folder: string, id: string): string =>
	`<base href="${folder}/${id}/"><script data-cd-canvas-runtime>${ARTBOARD_CANVAS_RUNTIME_SOURCE}</script>`;

test('labels and group headings are escaped and appear only as text', () => {
	const hostile = `<img src=x onerror=alert(1)> & "q" 'a'`;
	const html = buildCanvasPreviewHtml({
		exportId: 'canvas-1',
		frames: [frame({ id: 'a', label: hostile, group: hostile, folder: 'img-src-x' })],
	});
	assert.ok(!html.includes('<img'));
	assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;a&#39;'));
	assert.equal(
		html.match(/class="cd-heading"[^>]*>([^<]*)</)?.[1],
		'&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;a&#39;',
	);
});

test('one sandboxed srcdoc iframe per frame with title and data-cd-frame', () => {
	const html = buildCanvasPreviewHtml({
		exportId: 'canvas-1',
		frames: [frame({ id: 'a' }), frame({ id: 'b.v2', x: 500 })],
	});
	const tags = iframeTags(html);
	assert.equal(tags.length, 2);
	assert.deepEqual(
		tags.map((tag) => attributeOf(tag, 'data-cd-frame')),
		['a', 'b.v2'],
	);
	for (const tag of tags) {
		assert.equal(attributeOf(tag, 'sandbox'), 'allow-scripts');
		assert.ok(attributeOf(tag, 'srcdoc') !== undefined);
		assert.ok(attributeOf(tag, 'title') !== undefined);
		assert.equal(attributeOf(tag, 'src'), undefined);
	}
});

test('decoded srcdoc is exactly the preview copy and its tail is the frame HTML', () => {
	const inputs = [
		'<p class="x">a &amp; b</p><script>console.log("</script>")</script>',
		'',
		'<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>"q"</body></html>',
	];
	for (const input of inputs) {
		const html = buildCanvasPreviewHtml({
			exportId: 'canvas-1',
			frames: [frame({ id: 'a', folder: 'desktop', html: input })],
		});
		const tag = iframeTags(html)[0];
		assert.ok(tag !== undefined);
		const decoded = decodeAttribute(attributeOf(tag, 'srcdoc') ?? '');
		const preview = buildPreviewFrameHtml({ html: input, folder: 'desktop', id: 'a' });
		assert.equal(decoded, preview);
		const block = runtimeBlock('desktop', 'a');
		const blockIndex = preview.indexOf(block);
		assert.ok(blockIndex >= 0);
		assert.equal(preview.slice(0, blockIndex) + preview.slice(blockIndex + block.length), input);
	}
});

test('runtime injects after head, else after html, else at the start', () => {
	const block = runtimeBlock('g', 'a');
	const inject = (html: string): string => buildPreviewFrameHtml({ html, folder: 'g', id: 'a' });
	assert.equal(
		inject('<html><HEAD data-x="1"><title>t</title></HEAD></html>'),
		`<html><HEAD data-x="1">${block}<title>t</title></HEAD></html>`,
	);
	assert.equal(
		inject('<html lang="en"><header>h</header></html>'),
		`<html lang="en">${block}<header>h</header></html>`,
	);
	assert.equal(inject('<p>x</p>'), `${block}<p>x</p>`);
	assert.equal(inject(''), block);
});

test('negative coordinates shift every box past the padding', () => {
	const html = buildCanvasPreviewHtml({
		exportId: 'canvas-1',
		frames: [
			frame({ id: 'a', x: -300, y: -200, group: 'Desktop' }),
			frame({ id: 'b', x: 200, y: 100 }),
		],
	});
	const boxes = html.match(/<(div|iframe) class="cd-[^"]*" style="[^"]*"|<iframe [^>]*>/g) ?? [];
	assert.ok(boxes.length >= 5);
	for (const box of boxes) {
		assert.ok(styleNumber(box, 'left') >= 48);
		assert.ok(styleNumber(box, 'top') >= 48);
	}
	const heading = boxes.find((box) => box.includes('cd-heading'));
	assert.ok(heading !== undefined);
	assert.equal(styleNumber(heading, 'left'), 48);
	assert.equal(styleNumber(heading, 'top'), 48);
	const [first] = iframeTags(html);
	assert.ok(first !== undefined);
	assert.equal(styleNumber(first, 'top'), 48 + 24 + 32);
});

test('one heading per distinct non-empty group, none for ungrouped frames', () => {
	const html = buildCanvasPreviewHtml({
		exportId: 'canvas-1',
		frames: [
			frame({ id: 'a', group: 'Desktop', folder: 'desktop' }),
			frame({ id: 'b', group: 'Desktop', folder: 'desktop', x: 500 }),
			frame({ id: 'c', group: 'Mobile', folder: 'mobile', y: 1000 }),
			frame({ id: 'd', y: 2000 }),
		],
	});
	assert.deepEqual(
		[...html.matchAll(/class="cd-heading"[^>]*>([^<]*)</g)].map((match) => match[1]),
		['Desktop', 'Mobile'],
	);
});

test('parent document has exactly one script and it is free of closing-tag sequences', () => {
	const html = buildCanvasPreviewHtml({
		exportId: 'canvas-1',
		frames: [frame({ id: 'a', html: '<script>alert(1)</script>' })],
	});
	assert.equal(html.match(/<script/gi)?.length, 1);
	const scriptBody = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
	assert.ok(scriptBody !== undefined);
	assert.ok(!scriptBody.includes('</'));
	assert.ok(scriptBody.includes('nextFrameHeight'));
});
