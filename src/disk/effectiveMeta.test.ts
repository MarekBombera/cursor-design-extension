import assert from 'node:assert/strict';
import { test } from 'node:test';

import { effectiveArtboardMeta } from './effectiveMeta';
import { hashHtml } from './hash';
import { DEFAULT_ARTBOARD_TITLE, DEFAULT_VIEWPORT } from './layout';
import { type ArtboardMeta } from './parse';

const HTML = '<p>hero</p>';

const storedMeta = (overrides?: Partial<ArtboardMeta>): ArtboardMeta => ({
	id: 'hero',
	title: 'Hero',
	generation: 3,
	hash: hashHtml(HTML),
	viewport: '800x600',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

test('matching hash returns the stored meta', () => {
	const meta = storedMeta();
	assert.equal(effectiveArtboardMeta({ html: HTML, meta, artboardId: 'hero' }), meta);
});

test('matching hash is case-insensitive', () => {
	const hash = hashHtml(HTML);
	const meta = storedMeta({ hash: `sha256:${hash.slice('sha256:'.length).toUpperCase()}` });
	assert.equal(effectiveArtboardMeta({ html: HTML, meta, artboardId: 'hero' }), meta);
});

test('hash mismatch bumps generation and keeps updatedAt', () => {
	const meta = storedMeta();
	const next = effectiveArtboardMeta({ html: '<p>next</p>', meta, artboardId: 'hero' });
	assert.equal(next.generation, 4);
	assert.equal(next.hash, hashHtml('<p>next</p>'));
	assert.equal(next.updatedAt, meta.updatedAt);
	assert.equal(next.title, meta.title);
});

test('missing meta uses layout defaults at generation 1', () => {
	assert.deepEqual(effectiveArtboardMeta({ html: HTML, meta: undefined, artboardId: 'hero' }), {
		id: 'hero',
		title: DEFAULT_ARTBOARD_TITLE,
		generation: 1,
		hash: hashHtml(HTML),
		viewport: DEFAULT_VIEWPORT,
		updatedAt: '',
	});
});
