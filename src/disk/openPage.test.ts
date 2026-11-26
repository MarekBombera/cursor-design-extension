import assert from 'node:assert/strict';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	symlink,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';

import {
	CorruptProjectError,
	DiskError,
	MigrationConflictError,
	PageNotFoundError,
	UnsupportedProjectVersionError,
} from './errors';
import { PAGE_ENTRIES, type PageEntry } from './layout';
import { resolveOpenPage, resolveRequestedPage } from './openPage';
import type { WithWorkspaceLockArgs } from './workspaceLock';

// onLocked runs once the resolver holds the lock, before its locked work: another process that
// settled the folder while this call waited.
const lockHook = vi.hoisted(() => ({
	onLocked: undefined as ((workspaceRoot: string) => Promise<void>) | undefined,
}));

vi.mock('./workspaceLock', async (importOriginal) => {
	const original = await importOriginal<typeof import('./workspaceLock')>();
	return {
		...original,
		withWorkspaceLock: <T>(args: WithWorkspaceLockArgs<T>): Promise<T> =>
			original.withWorkspaceLock({
				...args,
				operation: async () => {
					await lockHook.onLocked?.(args.workspaceRoot);
					return args.operation();
				},
			}),
	};
});

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-open-page-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	lockHook.onLocked = undefined;
	vi.restoreAllMocks();
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const TOMBSTONE_TEXT = `vibeboard keeps artboards in .vibeboard/pages/<page id>/artboards/ now.
Do not delete or replace this file. It stops an older vibeboard MCP server from writing artboards here, where the extension no longer reads them.
If a vibeboard tool fails with ".vibeboard/artboards must be a directory (symlinks rejected).", quit and reopen your editor or restart your agent.
`;

const PAGE_ONE_PROJECT = {
	version: 1,
	openPageId: 'page-1',
	pages: [{ id: 'page-1', title: 'Page 1' }],
};

const designDir = (root: string, ...names: string[]): string => join(root, '.vibeboard', ...names);

const pageOneDir = (root: string, ...names: string[]): string =>
	designDir(root, 'pages', 'page-1', ...names);

// path relative to root -> "dir" | "link:<target>" | "file:<bytes>", optionally with its mtime.
const readTree = async (
	root: string,
	{ withMtime = false }: { withMtime?: boolean } = {},
): Promise<Record<string, string>> => {
	const tree: Record<string, string> = {};
	const walk = async (relativePath: string): Promise<void> => {
		const absolutePath = join(root, relativePath);
		const entryStats = await lstat(absolutePath);
		const mtime = withMtime ? ` @${entryStats.mtimeMs}` : '';
		if (entryStats.isSymbolicLink()) {
			tree[relativePath] = `link:${await readlink(absolutePath)}${mtime}`;
		} else if (entryStats.isDirectory()) {
			tree[relativePath] = `dir${mtime}`;
			for (const name of (await readdir(absolutePath)).sort()) {
				await walk(join(relativePath, name));
			}
		} else {
			tree[relativePath] = `file:${await readFile(absolutePath, 'utf8')}${mtime}`;
		}
	};
	for (const name of (await readdir(root)).sort()) {
		await walk(name);
	}
	return tree;
};

const JSON_TEXT: Record<Exclude<PageEntry, 'artboards'>, string> = {
	'manifest.json': '{"version":1,"activeArtboardId":"hero"}\n',
	'canvas.json': '{"version":1,"frames":[]}\n',
	'comments.json': '{"version":1,"comments":[]}\n',
};

const seedRootEntry = async (root: string, name: PageEntry): Promise<void> => {
	await mkdir(designDir(root), { recursive: true });
	if (name === 'artboards') {
		await mkdir(designDir(root, 'artboards'));
		await writeFile(designDir(root, 'artboards', 'hero.html'), '<p>hero</p>\n');
		await writeFile(designDir(root, 'artboards', 'hero.meta.json'), '{"id":"hero"}\n');
		return;
	}
	await writeFile(designDir(root, name), JSON_TEXT[name]);
};

const seedLegacy = async (root: string, names: readonly PageEntry[]): Promise<void> => {
	for (const name of names) {
		await seedRootEntry(root, name);
	}
};

// The tree a clean migration of `before` gives: page entries under pages/page-1/, plus the
// tombstone and project.json; everything else where it was.
const migratedTree = (before: Record<string, string>): Record<string, string> => {
	const after: Record<string, string> = {};
	for (const [path, value] of Object.entries(before)) {
		const [top, name, ...rest] = path.split('/');
		const isPageEntry =
			top === '.vibeboard' && PAGE_ENTRIES.some((entry) => entry === name) && name !== undefined;
		after[isPageEntry ? ['.vibeboard/pages/page-1', name, ...rest].join('/') : path] = value;
	}
	after['.vibeboard/pages'] = 'dir';
	after['.vibeboard/pages/page-1'] = 'dir';
	after['.vibeboard/artboards'] = `file:${TOMBSTONE_TEXT}`;
	after['.vibeboard/project.json'] = `file:${JSON.stringify(PAGE_ONE_PROJECT, null, 2)}\n`;
	return after;
};

const resolveFirstPage = async (root: string, createIfFresh = false): Promise<void> => {
	assert.deepEqual(await resolveOpenPage({ workspaceRoot: root, createIfFresh }), {
		workspaceRoot: root,
		pageId: 'page-1',
	});
};

const readProject = async (root: string): Promise<unknown> =>
	JSON.parse(await readFile(designDir(root, 'project.json'), 'utf8')) as unknown;

const LEGACY_SUBSETS: readonly (readonly PageEntry[])[] = [
	['artboards'],
	['manifest.json'],
	PAGE_ENTRIES,
	['artboards', 'comments.json'],
];

test('each legacy subset migrates into page-1 byte for byte', async () => {
	for (const names of LEGACY_SUBSETS) {
		const root = await makeTempRoot();
		await seedLegacy(root, names);
		const before = await readTree(root);
		await resolveFirstPage(root);
		assert.deepEqual(await readTree(root), migratedTree(before), names.join(', '));
		assert.deepEqual(await readProject(root), PAGE_ONE_PROJECT);
		assert.equal(await readFile(designDir(root, 'artboards'), 'utf8'), TOMBSTONE_TEXT);
	}
});

test('every interrupted migration resumes to the clean result', async () => {
	const interruptions: readonly ((root: string) => Promise<void>)[] = [
		// after b: empty page folder
		async (root) => {
			await mkdir(pageOneDir(root), { recursive: true });
		},
		// after c: artboards moved, no tombstone
		async (root) => {
			await mkdir(pageOneDir(root), { recursive: true });
			await rename(designDir(root, 'artboards'), pageOneDir(root, 'artboards'));
		},
		// after d: tombstone, JSON files still at the root
		async (root) => {
			await mkdir(pageOneDir(root), { recursive: true });
			await rename(designDir(root, 'artboards'), pageOneDir(root, 'artboards'));
			await writeFile(designDir(root, 'artboards'), TOMBSTONE_TEXT);
		},
		// partial e: one JSON file moved
		async (root) => {
			await mkdir(pageOneDir(root), { recursive: true });
			await rename(designDir(root, 'artboards'), pageOneDir(root, 'artboards'));
			await writeFile(designDir(root, 'artboards'), TOMBSTONE_TEXT);
			await rename(designDir(root, 'manifest.json'), pageOneDir(root, 'manifest.json'));
		},
		// after e: everything moved, no index
		async (root) => {
			await mkdir(pageOneDir(root), { recursive: true });
			await rename(designDir(root, 'artboards'), pageOneDir(root, 'artboards'));
			await writeFile(designDir(root, 'artboards'), TOMBSTONE_TEXT);
			for (const name of ['manifest.json', 'canvas.json', 'comments.json']) {
				await rename(designDir(root, name), pageOneDir(root, name));
			}
		},
	];
	for (const [index, interrupt] of interruptions.entries()) {
		const root = await makeTempRoot();
		await seedLegacy(root, PAGE_ENTRIES);
		const expected = migratedTree(await readTree(root));
		await interrupt(root);
		await resolveFirstPage(root);
		assert.deepEqual(await readTree(root), expected, `interruption ${index}`);
	}
});

const assertConflict = async ({
	root,
	names,
	message,
}: {
	root: string;
	names: readonly PageEntry[];
	message?: string;
}): Promise<void> => {
	// No mtimes: the conflict is found under the lock, whose file touches the folder's mtime.
	const before = await readTree(root);
	await assert.rejects(resolveOpenPage({ workspaceRoot: root, createIfFresh: true }), (error) => {
		assert.ok(error instanceof MigrationConflictError);
		assert.equal(error.code, 'MIGRATION_CONFLICT');
		assert.deepEqual(error.names, names);
		if (message !== undefined) {
			assert.equal(error.message, message);
		}
		return true;
	});
	assert.deepEqual(await readTree(root), before);
};

const seedPageEntry = async (root: string, name: PageEntry): Promise<void> => {
	await mkdir(pageOneDir(root), { recursive: true });
	if (name === 'artboards') {
		await mkdir(pageOneDir(root, 'artboards'));
		await writeFile(pageOneDir(root, 'artboards', 'other.html'), '<p>other</p>\n');
		return;
	}
	await writeFile(pageOneDir(root, name), '{"version":1}\n');
};

test('a page entry that exists in both places refuses the migration and moves nothing', async () => {
	for (const name of PAGE_ENTRIES) {
		const root = await makeTempRoot();
		await seedLegacy(root, PAGE_ENTRIES);
		await seedPageEntry(root, name);
		await assertConflict({ root, names: [name] });
	}
});

test('two JSON conflicts are named together in one message', async () => {
	const root = await makeTempRoot();
	await seedLegacy(root, PAGE_ENTRIES);
	await seedPageEntry(root, 'manifest.json');
	await seedPageEntry(root, 'comments.json');
	await assertConflict({
		root,
		names: ['manifest.json', 'comments.json'],
		message:
			'Cannot move the existing design into .vibeboard/pages/page-1/: .vibeboard/manifest.json and .vibeboard/pages/page-1/manifest.json both exist; .vibeboard/comments.json and .vibeboard/pages/page-1/comments.json both exist. Keep one copy of each JSON file: move or delete the other by hand. Then retry.',
	});
});

const ARTBOARDS_CONFLICT_MESSAGE =
	'Cannot move the existing design into .vibeboard/pages/page-1/: .vibeboard/artboards/ is a folder, but artboards now live in .vibeboard/pages/page-1/artboards/. Move the files you want from .vibeboard/artboards/ into .vibeboard/pages/page-1/artboards/, then delete .vibeboard/artboards/ (quit and reopen your editor or restart your agent first if an older vibeboard MCP server may still be running). Then retry.';

test('a stale artboards folder between the move and the tombstone is a conflict', async () => {
	const root = await makeTempRoot();
	await seedLegacy(root, PAGE_ENTRIES);
	await mkdir(pageOneDir(root), { recursive: true });
	await rename(designDir(root, 'artboards'), pageOneDir(root, 'artboards'));
	await seedRootEntry(root, 'artboards');
	await assertConflict({ root, names: ['artboards'], message: ARTBOARDS_CONFLICT_MESSAGE });
});

const seedIndexed = async (root: string, openPageId = 'page-1'): Promise<void> => {
	await mkdir(designDir(root, 'pages', openPageId), { recursive: true });
	await writeFile(
		designDir(root, 'project.json'),
		`${JSON.stringify({ version: 1, openPageId, pages: [{ id: openPageId, title: 'Home' }] }, null, 2)}\n`,
	);
	await writeFile(designDir(root, 'artboards'), TOMBSTONE_TEXT);
};

test('an indexed folder with a root artboards folder is a conflict on the open page', async () => {
	const root = await makeTempRoot();
	await seedIndexed(root, 'page-3');
	await unlink(designDir(root, 'artboards'));
	await seedRootEntry(root, 'artboards');
	const before = await readTree(root, { withMtime: true });
	await assert.rejects(resolveOpenPage({ workspaceRoot: root, createIfFresh: true }), (error) => {
		assert.ok(error instanceof MigrationConflictError);
		assert.equal(error.pageId, 'page-3');
		assert.equal(
			error.message,
			new MigrationConflictError({ pageId: 'page-3', names: ['artboards'] }).message,
		);
		return true;
	});
	assert.deepEqual(await readTree(root, { withMtime: true }), before);
});

test('an indexed folder rewrites a deleted tombstone and nothing else', async () => {
	const root = await makeTempRoot();
	await seedIndexed(root, 'page-2');
	await unlink(designDir(root, 'artboards'));
	const before = await readTree(root);
	assert.deepEqual(await resolveOpenPage({ workspaceRoot: root, createIfFresh: false }), {
		workspaceRoot: root,
		pageId: 'page-2',
	});
	assert.deepEqual(await readTree(root), {
		...before,
		'.vibeboard/artboards': `file:${TOMBSTONE_TEXT}`,
	});
});

test('unknown root entries stay where they are, byte for byte', async () => {
	const root = await makeTempRoot();
	await seedLegacy(root, PAGE_ENTRIES);
	await mkdir(designDir(root, 'picking-harness'));
	await writeFile(designDir(root, 'picking-harness', 'index.html'), '<p>pick</p>\n');
	await mkdir(designDir(root, 'handoff', 'hero-1'), { recursive: true });
	await writeFile(designDir(root, 'handoff', 'hero-1', 'IMPLEMENT.md'), '# Implement\n');
	await writeFile(designDir(root, 'tokens.json'), '{"color":"red"}\n');
	await mkdir(designDir(root, 'assets'));
	await writeFile(designDir(root, 'assets', 'logo.svg'), '<svg/>\n');
	await writeFile(designDir(root, '.ensure-panel'), 'hero\n');
	const before = await readTree(root);
	await resolveFirstPage(root);
	// migratedTree keeps every non-page entry at its path with its bytes.
	assert.deepEqual(await readTree(root), migratedTree(before));
});

test('a second resolve on a migrated folder writes nothing', async () => {
	const root = await makeTempRoot();
	await seedLegacy(root, PAGE_ENTRIES);
	await resolveFirstPage(root);
	const before = await readTree(root, { withMtime: true });
	await resolveFirstPage(root, true);
	assert.deepEqual(await readTree(root, { withMtime: true }), before);
});

test('a tombstone is not legacy: with a page folder and no index it rebuilds', async () => {
	const root = await makeTempRoot();
	await mkdir(pageOneDir(root, 'artboards'), { recursive: true });
	await writeFile(pageOneDir(root, 'artboards', 'hero.html'), '<p>hero</p>\n');
	await writeFile(designDir(root, 'artboards'), TOMBSTONE_TEXT);
	const before = await readTree(root);
	await resolveFirstPage(root);
	assert.deepEqual(await readTree(root), {
		...before,
		'.vibeboard/project.json': `file:${JSON.stringify(PAGE_ONE_PROJECT, null, 2)}\n`,
	});
});

test('a rebuild lists only real page folders, lowest number open', async () => {
	const root = await makeTempRoot();
	await mkdir(designDir(root, 'pages', 'page-3'), { recursive: true });
	await mkdir(designDir(root, 'pages', 'page-1'));
	await mkdir(designDir(root, 'pages', 'notes'));
	await symlink(designDir(root, 'pages', 'page-1'), designDir(root, 'pages', 'page-2'));
	await writeFile(designDir(root, 'pages', 'page-4'), 'not a folder\n');
	await resolveFirstPage(root);
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-1',
		pages: [
			{ id: 'page-1', title: 'Page 1' },
			{ id: 'page-3', title: 'Page 3' },
		],
	});
	assert.equal(await readFile(designDir(root, 'artboards'), 'utf8'), TOMBSTONE_TEXT);

	const onlyThird = await makeTempRoot();
	await mkdir(designDir(onlyThird, 'pages', 'page-3'), { recursive: true });
	assert.deepEqual(await resolveOpenPage({ workspaceRoot: onlyThird, createIfFresh: false }), {
		workspaceRoot: onlyThird,
		pageId: 'page-3',
	});
	assert.deepEqual(await readProject(onlyThird), {
		version: 1,
		openPageId: 'page-3',
		pages: [{ id: 'page-3', title: 'Page 3' }],
	});
});

test('a broken project.json throws its code and writes nothing', async () => {
	const cases: readonly { text: string; check: (error: unknown) => boolean }[] = [
		{
			text: 'not json',
			check: (error) => error instanceof CorruptProjectError && error.cause instanceof SyntaxError,
		},
		{
			text: JSON.stringify({ ...PAGE_ONE_PROJECT, version: 2 }),
			check: (error) => error instanceof UnsupportedProjectVersionError,
		},
	];
	for (const { text, check } of cases) {
		const root = await makeTempRoot();
		await seedLegacy(root, PAGE_ENTRIES);
		await writeFile(designDir(root, 'project.json'), text);
		const before = await readTree(root, { withMtime: true });
		await assert.rejects(resolveOpenPage({ workspaceRoot: root, createIfFresh: true }), check);
		assert.deepEqual(await readTree(root, { withMtime: true }), before);
	}
});

test('a fresh write creates the index, the tombstone and an empty page-1', async () => {
	const root = await makeTempRoot();
	await resolveFirstPage(root, true);
	assert.deepEqual(await readTree(root), {
		'.vibeboard': 'dir',
		'.vibeboard/artboards': `file:${TOMBSTONE_TEXT}`,
		'.vibeboard/pages': 'dir',
		'.vibeboard/pages/page-1': 'dir',
		'.vibeboard/project.json': `file:${JSON.stringify(PAGE_ONE_PROJECT, null, 2)}\n`,
	});
});

test('.vibeboard as a file or pages as a symlink is the directory DiskError', async () => {
	const fileRoot = await makeTempRoot();
	await writeFile(designDir(fileRoot), 'not a folder\n');
	await assert.rejects(
		resolveOpenPage({ workspaceRoot: fileRoot, createIfFresh: true }),
		(error) =>
			error instanceof DiskError &&
			error.message === '.vibeboard must be a directory (symlinks rejected).',
	);

	const linkRoot = await makeTempRoot();
	await mkdir(join(linkRoot, 'elsewhere', 'page-1'), { recursive: true });
	await mkdir(designDir(linkRoot));
	await symlink(join(linkRoot, 'elsewhere'), designDir(linkRoot, 'pages'));
	await assert.rejects(
		resolveOpenPage({ workspaceRoot: linkRoot, createIfFresh: true }),
		(error) =>
			error instanceof DiskError &&
			error.message === '.vibeboard/pages must be a directory (symlinks rejected).',
	);
});

test('two racing resolves on one legacy folder both get page-1 and migrate once', async () => {
	const root = await makeTempRoot();
	await seedLegacy(root, PAGE_ENTRIES);
	const expected = migratedTree(await readTree(root));
	const pages = await Promise.all([
		resolveOpenPage({ workspaceRoot: root, createIfFresh: true }),
		resolveOpenPage({ workspaceRoot: root, createIfFresh: false }),
	]);
	assert.deepEqual(
		pages.map(({ pageId }) => pageId),
		['page-1', 'page-1'],
	);
	assert.deepEqual(await readTree(root), expected);
});

test('a folder settled while this call waited on the lock is opened under the lock, not created', async () => {
	const root = await makeTempRoot();
	const settledProject = `${JSON.stringify({ version: 1, openPageId: 'page-1', pages: [{ id: 'page-1', title: 'Home' }] }, null, 2)}\n`;
	// Fresh when classified lock-free; Indexed, with a hand-edited title, once the lock is held.
	lockHook.onLocked = async (workspaceRoot) => {
		await seedIndexed(workspaceRoot);
	};
	await resolveFirstPage(root, true);
	assert.equal(await readFile(designDir(root, 'project.json'), 'utf8'), settledProject);
});

test('a rebuild over 101 page folders lists the lowest 100 and logs the rest', async () => {
	const root = await makeTempRoot();
	for (let pageNumber = 101; pageNumber >= 1; pageNumber -= 1) {
		await mkdir(designDir(root, 'pages', `page-${pageNumber}`), { recursive: true });
	}
	const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	await resolveFirstPage(root);
	const project = (await readProject(root)) as { openPageId: string; pages: { id: string }[] };
	assert.equal(project.openPageId, 'page-1');
	assert.deepEqual(
		project.pages.map(({ id }) => id),
		Array.from({ length: 100 }, (_, index) => `page-${index + 1}`),
	);
	// Once per classify: lock-free, then under the lock; the rebuild reuses the locked scan.
	const capLine = 'vibeboard: page folder scan failed: 1 page folders past 100 are not listed\n';
	assert.deepEqual(
		stderrWrite.mock.calls.map(([text]) => text),
		[capLine, capLine],
	);
});

test('a file at pages/page-1 in a legacy folder is the directory DiskError and moves nothing', async () => {
	const root = await makeTempRoot();
	await seedLegacy(root, PAGE_ENTRIES);
	await mkdir(designDir(root, 'pages'));
	await writeFile(pageOneDir(root), 'not a folder\n');
	const before = await readTree(root);
	await assert.rejects(
		resolveOpenPage({ workspaceRoot: root, createIfFresh: true }),
		(error) =>
			error instanceof DiskError &&
			error.message === '.vibeboard/pages/page-1 must be a directory (symlinks rejected).',
	);
	assert.deepEqual(await readTree(root), before);
});

// page-1 open, page-2 indexed with its folder, page-3 indexed with no folder.
const seedTwoPageProject = async (root: string): Promise<void> => {
	await mkdir(pageOneDir(root), { recursive: true });
	await mkdir(designDir(root, 'pages', 'page-2'));
	await writeFile(designDir(root, 'artboards'), TOMBSTONE_TEXT);
	await writeFile(
		designDir(root, 'project.json'),
		JSON.stringify({
			...PAGE_ONE_PROJECT,
			pages: [
				{ id: 'page-1', title: 'Page 1' },
				{ id: 'page-2', title: 'Page 2' },
				{ id: 'page-3', title: 'Page 3' },
			],
		}),
	);
};

test('resolveRequestedPage returns the open page or another indexed page with a folder', async () => {
	const root = await makeTempRoot();
	await seedTwoPageProject(root);
	const before = await readTree(root, { withMtime: true });
	for (const pageId of ['page-1', 'page-2']) {
		assert.deepEqual(await resolveRequestedPage({ workspaceRoot: root, pageId }), {
			workspaceRoot: root,
			pageId,
		});
	}
	assert.deepEqual(await readTree(root, { withMtime: true }), before);
});

test('resolveRequestedPage refuses an unindexed id, an unindexed folder, a missing folder and a malformed id', async () => {
	const root = await makeTempRoot();
	await seedTwoPageProject(root);
	// page-5 has a folder that project.json does not list: only the index check refuses it.
	await mkdir(designDir(root, 'pages', 'page-5'));
	const before = await readTree(root, { withMtime: true });
	const unlisted = (pageId: string): string =>
		`Page "${pageId}" does not exist. Call list_pages for the page ids.`;
	const noFolder = (pageId: string): string =>
		`Page "${pageId}" has no folder. Restore .vibeboard/pages/${pageId}/, or delete .vibeboard/project.json to rebuild the page list from the page folders.`;
	for (const [pageId, message] of [
		['page-4', unlisted('page-4')],
		['page-5', unlisted('page-5')],
		['page-3', noFolder('page-3')],
		['../x', noFolder('../x')],
	] as const) {
		await assert.rejects(
			resolveRequestedPage({ workspaceRoot: root, pageId }),
			(error: unknown) =>
				error instanceof PageNotFoundError && error.pageId === pageId && error.message === message,
			pageId,
		);
	}
	assert.deepEqual(await readTree(root, { withMtime: true }), before);
});

test('on a fresh folder page-1 is the open page and page-2 is not found; nothing is written', async () => {
	const root = await makeTempRoot();
	assert.deepEqual(await resolveRequestedPage({ workspaceRoot: root, pageId: 'page-1' }), {
		workspaceRoot: root,
		pageId: 'page-1',
	});
	await assert.rejects(
		resolveRequestedPage({ workspaceRoot: root, pageId: 'page-2' }),
		(error: unknown) => error instanceof PageNotFoundError && error.code === 'PAGE_NOT_FOUND',
	);
	assert.deepEqual(await readdir(root), []);
});
