import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';

import type { ArtboardEdit } from './artboardEdit';
import { editArtboard } from './artboardEditFs';
import { createArtboard, readArtboard } from './artboardFs';
import {
	ArtboardNotFoundError,
	ConflictError,
	EditRefusedError,
	type EditRefusedReason,
	InvalidArgsError,
} from './errors';
import { hashHtml } from './hash';
import {
	MAX_POSTED_ARTBOARD_HTML_CHARS,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
} from './layout';

// Test seam: rewrite the file once, synchronously, between editArtboard's pre-read parse and the
// lock its updateArtboard call takes.
const seam = vi.hoisted(() => ({ rewrite: undefined as (() => void) | undefined }));

vi.mock('./commentViews', async (importOriginal) => {
	const original = await importOriginal<typeof import('./commentViews')>();
	return {
		...original,
		cachedArtboardDocument: (args: Parameters<typeof original.cachedArtboardDocument>[0]) => {
			const document = original.cachedArtboardDocument(args);
			const rewrite = seam.rewrite;
			seam.rewrite = undefined;
			rewrite?.();
			return document;
		},
	};
});

const tempRoots: string[] = [];

afterEach(async () => {
	seam.rewrite = undefined;
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const seed = async (html: string): Promise<{ workspaceRoot: string; htmlPath: string }> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-edit-'));
	tempRoots.push(workspaceRoot);
	await createArtboard({ workspaceRoot, artboardId: 'hero', html, writeEnsurePanelMarker: false });
	return { workspaceRoot, htmlPath: join(workspaceRoot, ...artboardHtmlPathSegments('hero')) };
};

const fontSize = (sourceNumber: number, value: string): ArtboardEdit => ({
	sourceNumber,
	styles: [{ field: 'font-size', value }],
});

const assertRefused = async (run: Promise<unknown>, reason: EditRefusedReason): Promise<void> => {
	await assert.rejects(run, (error: unknown) => {
		assert.ok(error instanceof EditRefusedError);
		assert.equal(error.reason, reason);
		return true;
	});
};

test('a style edit writes only that declaration and returns the new hash and generation', async () => {
	const html = '<main>\n  <h1 style="color: red">Hi</h1>\n  <p>x</p>\n</main>\n';
	const { workspaceRoot, htmlPath } = await seed(html);
	const result = await editArtboard({
		workspaceRoot,
		artboardId: 'hero',
		baseHash: hashHtml(html),
		edit: fontSize(1, '24'),
	});
	const expected =
		'<main>\n  <h1 style="color: red; font-size: 24px">Hi</h1>\n  <p>x</p>\n</main>\n';
	assert.equal(await readFile(htmlPath, 'utf8'), expected);
	assert.deepEqual(result, {
		artboardId: 'hero',
		generation: 2,
		hash: hashHtml(expected),
		html: expected,
		baseHtml: html,
		baseHash: hashHtml(html),
	});
});

test('a stale base hash is a conflict and the file is untouched', async () => {
	const { workspaceRoot, htmlPath } = await seed('<p>a</p>');
	await assert.rejects(
		editArtboard({
			workspaceRoot,
			artboardId: 'hero',
			baseHash: hashHtml('<p>other</p>'),
			edit: fontSize(0, '12'),
		}),
		ConflictError,
	);
	assert.equal(await readFile(htmlPath, 'utf8'), '<p>a</p>');
});

test('each edit core refusal surfaces as EditRefusedError with its reason', async () => {
	const cases: { html: string; edit: ArtboardEdit; reason: EditRefusedReason }[] = [
		{ html: '<p>a</p>', edit: fontSize(9, '12'), reason: 'unknown-number' },
		{ html: '<p><b>x</p><p>y</p>', edit: fontSize(1, '12'), reason: 'shared-number' },
		{
			html: '<p>a<b>b</b></p>',
			edit: { sourceNumber: 0, field: 'text', value: 'c', liveText: 'ab' },
			reason: 'not-plain-text',
		},
		{
			html: '<p>Old</p>',
			edit: { sourceNumber: 0, field: 'text', value: 'New', liveText: 'Other' },
			reason: 'text-changed',
		},
		{ html: '<p>a</p>', edit: fontSize(0, '1px; color: red'), reason: 'invalid-value' },
		{ html: '<p style=a"b>x</p>', edit: fontSize(0, '12'), reason: 'unsupported-style' },
	];
	for (const { html, edit, reason } of cases) {
		const { workspaceRoot, htmlPath } = await seed(html);
		await assertRefused(
			editArtboard({ workspaceRoot, artboardId: 'hero', baseHash: hashHtml(html), edit }),
			reason,
		);
		assert.equal(await readFile(htmlPath, 'utf8'), html, reason);
	}
});

test('a file over the preview cap, or an edit that would cross it, is refused unwritten', async () => {
	const over = `<p>${'x'.repeat(MAX_POSTED_ARTBOARD_HTML_CHARS)}</p>`;
	const overSeed = await seed(over);
	// Number 9 does not exist: without the pre-parse size check this is unknown-number instead.
	await assertRefused(
		editArtboard({
			workspaceRoot: overSeed.workspaceRoot,
			artboardId: 'hero',
			baseHash: hashHtml(over),
			edit: fontSize(9, '12'),
		}),
		'too-large',
	);
	assert.equal(await readFile(overSeed.htmlPath, 'utf8'), over);
	const atCap = `<p>a</p>${'x'.repeat(MAX_POSTED_ARTBOARD_HTML_CHARS - 8)}`;
	const atCapSeed = await seed(atCap);
	await assertRefused(
		editArtboard({
			workspaceRoot: atCapSeed.workspaceRoot,
			artboardId: 'hero',
			baseHash: hashHtml(atCap),
			edit: fontSize(0, '12'),
		}),
		'too-large',
	);
	assert.equal(await readFile(atCapSeed.htmlPath, 'utf8'), atCap);
});

test('a same-value edit returns the current state without writing', async () => {
	const html = '<p style="font-size: 12px">a</p>';
	const { workspaceRoot, htmlPath } = await seed(html);
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments('hero'));
	const metaBefore = await readFile(metaPath, 'utf8');
	const mtimeBefore = (await stat(htmlPath)).mtimeMs;
	const result = await editArtboard({
		workspaceRoot,
		artboardId: 'hero',
		baseHash: hashHtml(html),
		edit: fontSize(0, '12px'),
	});
	assert.deepEqual(result, {
		artboardId: 'hero',
		generation: 1,
		hash: hashHtml(html),
		html,
		baseHtml: html,
		baseHash: hashHtml(html),
	});
	assert.equal(await readFile(metaPath, 'utf8'), metaBefore);
	assert.equal((await stat(htmlPath)).mtimeMs, mtimeBefore);
});

// The same-bytes path never reaches updateArtboard, so the pre-parse hash check is its only guard.
test('a same-value edit on a stale base is a conflict, not a success', async () => {
	const html = '<p style="font-size: 12px">a</p>';
	const { workspaceRoot } = await seed(html);
	await assert.rejects(
		editArtboard({
			workspaceRoot,
			artboardId: 'hero',
			baseHash: hashHtml('<p>older</p>'),
			edit: fontSize(0, '12px'),
		}),
		ConflictError,
	);
});

// Guards the exact-name check only on a case-insensitive disk (macOS, Windows), like the
// updateArtboard case test: on Linux `HERO` is simply not found.
test('a case variant id is ARTBOARD_NOT_FOUND, even for a same-value edit', async () => {
	const html = '<p style="font-size: 12px">a</p>';
	const { workspaceRoot } = await seed(html);
	await assert.rejects(
		editArtboard({
			workspaceRoot,
			artboardId: 'HERO',
			baseHash: hashHtml(html),
			edit: fontSize(0, '12px'),
		}),
		ArtboardNotFoundError,
	);
});

test('a workspace whose artboards dir is gone is ARTBOARD_NOT_FOUND, not a disk error', async () => {
	const { workspaceRoot, htmlPath } = await seed('<p>a</p>');
	await rm(dirname(htmlPath), { recursive: true });
	await assert.rejects(
		editArtboard({
			workspaceRoot,
			artboardId: 'hero',
			baseHash: hashHtml('<p>a</p>'),
			edit: fontSize(0, '12'),
		}),
		ArtboardNotFoundError,
	);
});

test('a malformed baseHash is InvalidArgsError before any read', async () => {
	await assert.rejects(
		editArtboard({
			workspaceRoot: join(tmpdir(), 'cursor-design-edit-never-created'),
			artboardId: 'hero',
			baseHash: 'sha256:xyz',
			edit: fontSize(0, '12'),
		}),
		InvalidArgsError,
	);
});

test('an unknown artboard is ARTBOARD_NOT_FOUND', async () => {
	const { workspaceRoot } = await seed('<p>a</p>');
	await assert.rejects(
		editArtboard({
			workspaceRoot,
			artboardId: 'missing',
			baseHash: hashHtml('<p>a</p>'),
			edit: fontSize(0, '12'),
		}),
		ArtboardNotFoundError,
	);
});

test('a write between the pre-read and the lock is a conflict and keeps the outside bytes', async () => {
	const { workspaceRoot, htmlPath } = await seed('<p>a</p>');
	seam.rewrite = () => {
		writeFileSync(htmlPath, '<p>outside</p>', 'utf8');
	};
	await assert.rejects(
		editArtboard({
			workspaceRoot,
			artboardId: 'hero',
			baseHash: hashHtml('<p>a</p>'),
			edit: fontSize(0, '12'),
		}),
		ConflictError,
	);
	assert.equal(await readFile(htmlPath, 'utf8'), '<p>outside</p>');
	assert.equal((await readArtboard({ workspaceRoot, artboardId: 'hero' })).html, '<p>outside</p>');
});
