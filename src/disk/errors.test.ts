import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	ArtboardNotFoundError,
	CorruptManifestError,
	CorruptMetaError,
	CorruptProjectError,
	DiskError,
	throwDiskError,
	UnsupportedProjectVersionError,
} from './errors';

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

test('throwDiskError wraps an fs failure as DISK_ERROR with authored copy and the cause, and rethrows a domain error', () => {
	const fsError = Object.assign(new Error('EACCES: /home/x'), { code: 'EACCES' });
	assert.throws(
		() => throwDiskError(fsError),
		(error: unknown) =>
			error instanceof DiskError &&
			error.code === 'DISK_ERROR' &&
			error.message ===
				'Could not read or write artboard files. Check Output/stderr; fix folder permissions.' &&
			error.cause === fsError,
	);
	const domain = new ArtboardNotFoundError('a');
	assert.throws(
		() => throwDiskError(domain),
		(error: unknown) => error === domain,
	);
});
