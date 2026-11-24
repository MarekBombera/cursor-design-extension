import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { VIBEBOARD_DIR } from './layout';
import { LEGACY_DESIGN_DIR, migrateLegacyDesignDir } from './layoutFs';

// TODO(1.0): remove .cursor-design migration (this whole file).
const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const makeWorkspace = async (folders: readonly string[]): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-legacy-dir-'));
	tempRoots.push(workspaceRoot);
	for (const folder of folders) {
		await mkdir(join(workspaceRoot, folder));
		await writeFile(join(workspaceRoot, folder, 'project.json'), folder, 'utf8');
	}
	return workspaceRoot;
};

test('migrateLegacyDesignDir moves only the old folder, never over a new one', async () => {
	const onlyLegacy = await makeWorkspace([LEGACY_DESIGN_DIR]);
	assert.equal(await migrateLegacyDesignDir(onlyLegacy), 'moved');
	assert.deepEqual(await readdir(onlyLegacy), [VIBEBOARD_DIR]);
	assert.deepEqual(await readdir(join(onlyLegacy, VIBEBOARD_DIR)), ['project.json']);

	const both = await makeWorkspace([LEGACY_DESIGN_DIR, VIBEBOARD_DIR]);
	assert.equal(await migrateLegacyDesignDir(both), 'both');
	assert.deepEqual((await readdir(both)).sort(), [LEGACY_DESIGN_DIR, VIBEBOARD_DIR].sort());

	const neither = await makeWorkspace([]);
	assert.equal(await migrateLegacyDesignDir(neither), 'none');
	assert.deepEqual(await readdir(neither), []);
});
