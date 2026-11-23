import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { type CommentsFile, readCommentsFile, writeCommentsFile } from './commentsFile';
import { CorruptCommentsError, UnsupportedCommentsVersionError } from './errors';
import {
	FIRST_PAGE_ID,
	CURSOR_DESIGN_DIR,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	commentsPathSegments,
} from './layout';
import { resolveOpenPage } from './openPage';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-comments-file-'));
	tempRoots.push(workspaceRoot);
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const HASH = `sha256:${'a'.repeat(64)}`;
const CREATED_AT = '2026-10-26T10:00:00.000Z';

const validComment = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: 'c1',
	frameId: 'hero',
	artboard: 'Landing',
	version: 1,
	selector: 'h1',
	tagName: 'h1',
	text: 'Hello',
	rect: { x: 0, y: 0, width: 10, height: 10 },
	pin: { x: 0.5, y: 0.25 },
	styles: { color: 'rgb(0, 0, 0)' },
	body: 'Make this bolder',
	isPage: false,
	targetFingerprint: HASH,
	status: 'open',
	createdAt: CREATED_AT,
	replies: [],
	...overrides,
});

const writeComments = async (workspaceRoot: string, text: string): Promise<string> => {
	const filePath = join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID));
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR), { recursive: true });
	await writeFile(filePath, text, 'utf8');
	return filePath;
};

// The parser's only way in: readCommentsFile over a comments.json holding `value`.
const parseOnDisk = async (value: unknown): Promise<CommentsFile> => {
	const workspaceRoot = await makeTempRoot();
	await writeComments(workspaceRoot, JSON.stringify(value));
	return readCommentsFile({ workspaceRoot, pageId: FIRST_PAGE_ID });
};

test('a missing comments file reads as an empty list', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.deepEqual(await readCommentsFile({ workspaceRoot, pageId: FIRST_PAGE_ID }), {
		version: 1,
		comments: [],
	});
});

test('null, {}, string version, 1.5 and a non-array comments are corrupt', async () => {
	await assert.rejects(parseOnDisk(null), CorruptCommentsError);
	await assert.rejects(parseOnDisk({}), CorruptCommentsError);
	await assert.rejects(parseOnDisk({ version: '1' }), CorruptCommentsError);
	await assert.rejects(parseOnDisk({ version: 1.5, comments: [] }), CorruptCommentsError);
	await assert.rejects(parseOnDisk({ version: 1, comments: {} }), CorruptCommentsError);
});

test('an empty comments file on disk is corrupt', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeComments(workspaceRoot, '');
	await assert.rejects(
		readCommentsFile({ workspaceRoot, pageId: FIRST_PAGE_ID }),
		CorruptCommentsError,
	);
});

test('version 2 is unsupported', async () => {
	await assert.rejects(parseOnDisk({ version: 2, comments: [] }), UnsupportedCommentsVersionError);
});

test('duplicate comment ids and duplicate reply ids are corrupt', async () => {
	await assert.rejects(
		parseOnDisk({
			version: 1,
			comments: [validComment(), validComment({ id: 'c1', selector: 'p' })],
		}),
		CorruptCommentsError,
	);
	await assert.rejects(
		parseOnDisk({
			version: 1,
			comments: [
				validComment({
					replies: [
						{ id: 'r1', author: 'user', body: 'one', createdAt: CREATED_AT },
						{ id: 'r1', author: 'user', body: 'two', createdAt: CREATED_AT },
					],
				}),
			],
		}),
		CorruptCommentsError,
	);
});

test('oversized, empty, and empty-reply bodies are corrupt', async () => {
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ body: 'x'.repeat(2001) })] }),
		CorruptCommentsError,
	);
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ body: '' })] }),
		CorruptCommentsError,
	);
	await assert.rejects(
		parseOnDisk({
			version: 1,
			comments: [
				validComment({
					replies: [{ id: 'r1', author: 'user', body: '', createdAt: CREATED_AT }],
				}),
			],
		}),
		CorruptCommentsError,
	);
});

test('over the comment count or reply cap is corrupt', async () => {
	const comments = Array.from({ length: MAX_COMMENTS + 1 }, (_, index) =>
		validComment({ id: `c${index}` }),
	);
	await assert.rejects(parseOnDisk({ version: 1, comments }), CorruptCommentsError);
	const replies = Array.from({ length: MAX_COMMENT_REPLIES + 1 }, (_, index) => ({
		id: `r${index}`,
		author: 'user',
		body: 'note',
		createdAt: CREATED_AT,
	}));
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ replies })] }),
		CorruptCommentsError,
	);
});

// A stored frameId is later joined into an artboard path with no containment check.
test('a path-like or empty frameId, non-hash fingerprint, newline selector, and upper-case tagName are corrupt', async () => {
	for (const frameId of ['../x', '']) {
		await assert.rejects(
			parseOnDisk({ version: 1, comments: [validComment({ frameId })] }),
			CorruptCommentsError,
			frameId,
		);
	}
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ targetFingerprint: 'nope' })] }),
		CorruptCommentsError,
	);
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ selector: 'h1\n' })] }),
		CorruptCommentsError,
	);
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ tagName: 'H1' })] }),
		CorruptCommentsError,
	);
});

test('an element comment with null rect and a page comment that is not body are corrupt', async () => {
	await assert.rejects(
		parseOnDisk({ version: 1, comments: [validComment({ rect: null })] }),
		CorruptCommentsError,
	);
	await assert.rejects(
		parseOnDisk({
			version: 1,
			comments: [
				validComment({
					isPage: true,
					selector: 'main',
					tagName: 'body',
					rect: null,
					targetFingerprint: undefined,
				}),
			],
		}),
		CorruptCommentsError,
	);
});

test('unknown fields, bad styles, oversize pin and upper-case hashes load', async () => {
	const parsed = await parseOnDisk({
		version: 1,
		extra: true,
		comments: [
			validComment({
				unknown: 1,
				pin: { x: 1.0000001, y: -0.2 },
				styles: { color: 'rgb(0, 0, 0)', 'font-size': '12px;evil', nope: '1px' },
				targetFingerprint: `sha256:${'A'.repeat(64)}`,
			}),
		],
	});
	assert.equal('extra' in parsed, false);
	assert.equal('unknown' in parsed.comments[0], false);
	assert.deepEqual(parsed.comments[0]?.pin, { x: 1, y: 0 });
	assert.deepEqual(parsed.comments[0]?.styles, { color: 'rgb(0, 0, 0)' });
	assert.equal(parsed.comments[0]?.targetFingerprint, `sha256:${'a'.repeat(64)}`);
});

test('serialize then parse keeps the documented key order', async () => {
	const file = await parseOnDisk({ version: 1, comments: [validComment()] });
	const page = { workspaceRoot: await makeTempRoot(), pageId: FIRST_PAGE_ID };
	await writeCommentsFile(page, file);
	const roundTrip = await readCommentsFile(page);
	assert.deepEqual(Object.keys(roundTrip.comments[0] ?? {}), [
		'id',
		'frameId',
		'artboard',
		'version',
		'selector',
		'tagName',
		'text',
		'rect',
		'pin',
		'styles',
		'body',
		'isPage',
		'targetFingerprint',
		'status',
		'createdAt',
		'replies',
	]);
});
