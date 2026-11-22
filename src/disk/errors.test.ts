import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	CorruptManifestError,
	CorruptMetaError,
	CorruptProjectError,
	MigrationConflictError,
	UnsupportedProjectVersionError,
} from './errors';

test('MigrationConflictError names both JSON copies and the JSON step', () => {
	const error = new MigrationConflictError({
		pageId: 'page-1',
		names: ['manifest.json', 'comments.json'],
	});
	assert.equal(error.code, 'MIGRATION_CONFLICT');
	assert.equal(
		error.message,
		'Cannot move the existing design into .cursor-design/pages/page-1/: .cursor-design/manifest.json and .cursor-design/pages/page-1/manifest.json both exist; .cursor-design/comments.json and .cursor-design/pages/page-1/comments.json both exist. Keep one copy of each JSON file: move or delete the other by hand. Then retry.',
	);
});

test('MigrationConflictError names a root artboards folder and the move step', () => {
	assert.equal(
		new MigrationConflictError({ pageId: 'page-1', names: ['artboards'] }).message,
		'Cannot move the existing design into .cursor-design/pages/page-1/: .cursor-design/artboards/ is a folder, but artboards now live in .cursor-design/pages/page-1/artboards/. Move the files you want from .cursor-design/artboards/ into .cursor-design/pages/page-1/artboards/, then delete .cursor-design/artboards/ (quit and reopen Cursor first if an older cursor-design MCP server may still be running). Then retry.',
	);
});

test('per-page errors name the page path and keep pageId and artboardId', () => {
	const manifest = new CorruptManifestError({ pageId: 'page-3' });
	assert.equal(manifest.pageId, 'page-3');
	assert.equal(
		manifest.message,
		'Artboard manifest is invalid. Fix or restore .cursor-design/pages/page-3/manifest.json (version 1).',
	);
	const meta = new CorruptMetaError({ pageId: 'page-3', artboardId: 'hero' });
	assert.equal(meta.artboardId, 'hero');
	assert.equal(meta.pageId, 'page-3');
});

test('the project index errors name project.json and the next step', () => {
	const corrupt = new CorruptProjectError();
	assert.equal(corrupt.code, 'CORRUPT_PROJECT');
	assert.equal(
		corrupt.message,
		'Project index is invalid. Fix .cursor-design/project.json (version 1), or delete it to rebuild the page list from the page folders. Page titles then reset to "Page <n>".',
	);
	const unsupported = new UnsupportedProjectVersionError(2);
	assert.equal(unsupported.code, 'UNSUPPORTED_PROJECT_VERSION');
	assert.equal(
		unsupported.message,
		'Project index version 2 is unsupported (expected 1). Update the cursor-design extension, or fix .cursor-design/project.json.',
	);
});
