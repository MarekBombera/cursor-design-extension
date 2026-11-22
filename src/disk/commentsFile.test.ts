import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { parseCommentsFile, readCommentsFile, serializeCommentsFile } from './commentsFile';
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

test('a missing comments file reads as an empty list', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.deepEqual(await readCommentsFile({ workspaceRoot, pageId: FIRST_PAGE_ID }), {
		version: 1,
		comments: [],
	});
});

test('empty file, {}, string version, 1.5 and a non-array comments are corrupt', () => {
	assert.throws(
		() => parseCommentsFile(JSON.parse('{}') as unknown, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
	assert.throws(() => parseCommentsFile({ version: '1' }, FIRST_PAGE_ID), CorruptCommentsError);
	assert.throws(
		() => parseCommentsFile({ version: 1.5, comments: [] }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: {} }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
});

test('an empty comments file on disk is corrupt', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeComments(workspaceRoot, '');
	await assert.rejects(
		readCommentsFile({ workspaceRoot, pageId: FIRST_PAGE_ID }),
		CorruptCommentsError,
	);
});

test('version 2 is unsupported', () => {
	assert.throws(
		() => parseCommentsFile({ version: 2, comments: [] }, FIRST_PAGE_ID),
		UnsupportedCommentsVersionError,
	);
});

test('duplicate comment ids and duplicate reply ids are corrupt', () => {
	assert.throws(
		() =>
			parseCommentsFile(
				{
					version: 1,
					comments: [validComment(), validComment({ id: 'c1', selector: 'p' })],
				},
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile(
				{
					version: 1,
					comments: [
						validComment({
							replies: [
								{ id: 'r1', author: 'user', body: 'one', createdAt: CREATED_AT },
								{ id: 'r1', author: 'user', body: 'two', createdAt: CREATED_AT },
							],
						}),
					],
				},
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
});

test('oversized, empty, and empty-reply bodies are corrupt', () => {
	assert.throws(
		() =>
			parseCommentsFile(
				{ version: 1, comments: [validComment({ body: 'x'.repeat(2001) })] },
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ body: '' })] }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile(
				{
					version: 1,
					comments: [
						validComment({
							replies: [{ id: 'r1', author: 'user', body: '', createdAt: CREATED_AT }],
						}),
					],
				},
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
});

test('over the comment count or reply cap is corrupt', () => {
	const comments = Array.from({ length: MAX_COMMENTS + 1 }, (_, index) =>
		validComment({ id: `c${index}` }),
	);
	assert.throws(
		() => parseCommentsFile({ version: 1, comments }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
	const replies = Array.from({ length: MAX_COMMENT_REPLIES + 1 }, (_, index) => ({
		id: `r${index}`,
		author: 'user',
		body: 'note',
		createdAt: CREATED_AT,
	}));
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ replies })] }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
});

test('a non-hash fingerprint, newline selector, and upper-case tagName are corrupt', () => {
	assert.throws(
		() =>
			parseCommentsFile(
				{ version: 1, comments: [validComment({ targetFingerprint: 'nope' })] },
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile(
				{ version: 1, comments: [validComment({ selector: 'h1\n' })] },
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile({ version: 1, comments: [validComment({ tagName: 'H1' })] }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
});

test('an element comment with null rect and a page comment that is not body are corrupt', () => {
	assert.throws(
		() =>
			parseCommentsFile({ version: 1, comments: [validComment({ rect: null })] }, FIRST_PAGE_ID),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile(
				{
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
				},
				FIRST_PAGE_ID,
			),
		CorruptCommentsError,
	);
});

test('unknown fields, bad styles, oversize pin and upper-case hashes load', () => {
	const parsed = parseCommentsFile(
		{
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
		},
		FIRST_PAGE_ID,
	);
	assert.equal('extra' in parsed, false);
	assert.equal('unknown' in parsed.comments[0], false);
	assert.deepEqual(parsed.comments[0]?.pin, { x: 1, y: 0 });
	assert.deepEqual(parsed.comments[0]?.styles, { color: 'rgb(0, 0, 0)' });
	assert.equal(parsed.comments[0]?.targetFingerprint, `sha256:${'a'.repeat(64)}`);
});

test('serialize then parse keeps the documented key order', () => {
	const file = parseCommentsFile({ version: 1, comments: [validComment()] }, FIRST_PAGE_ID);
	const roundTrip = parseCommentsFile(
		JSON.parse(serializeCommentsFile(file)) as unknown,
		FIRST_PAGE_ID,
	);
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
