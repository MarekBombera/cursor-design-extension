import assert from 'node:assert/strict';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { createArtboard } from './artboardFs';
import {
	addComment,
	getComment,
	listComments,
	markCommentsSent,
	parseCommentsFile,
	readCommentsFile,
	replyToComment,
	resolveComment,
	serializeCommentsFile,
	setCommentStatus,
	type NewComment,
} from './comments';
import { HINT_FRAME_MISSING, HINT_FRAME_UNREADABLE, HINT_UNCHECKED } from './commentTarget';
import {
	ArtboardNotFoundError,
	CommentNotFoundError,
	CommentResolvedError,
	CorruptCommentsError,
	InvalidArgsError,
	PickOutdatedError,
	UnsupportedCommentsVersionError,
} from './errors';
import {
	COMMENTS_SCHEMA_VERSION,
	CURSOR_DESIGN_DIR,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	commentsPathSegments,
} from './layout';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-comments-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const HASH = `sha256:${'a'.repeat(64)}`;
const CREATED_AT = '2026-10-26T10:00:00.000Z';
const HERO_HTML =
	'<!DOCTYPE html><html><body><main><h1>Hello</h1><p>World</p></main></body></html>';

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

const commentsFileOf = (comments: Record<string, unknown>[]): string =>
	`${JSON.stringify({ version: COMMENTS_SCHEMA_VERSION, comments }, null, 2)}\n`;

const seedHero = async (
	workspaceRoot: string,
	{ html = HERO_HTML, title }: { html?: string; title?: string } = {},
): Promise<void> => {
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html,
		title,
		writeEnsurePanelMarker: false,
	});
};

const pick = (overrides: Partial<NewComment> = {}): NewComment => ({
	frameId: 'hero',
	generation: 1,
	selector: 'h1',
	tagName: 'h1',
	text: 'Hello',
	rect: { x: 0, y: 0, width: 10, height: 10 },
	pin: { x: 0.5, y: 0.25 },
	styles: { color: 'rgb(0, 0, 0)' },
	body: 'Make this bolder',
	isPage: false,
	...overrides,
});

const writeComments = async (workspaceRoot: string, text: string): Promise<string> => {
	const filePath = join(workspaceRoot, ...commentsPathSegments);
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR), { recursive: true });
	await writeFile(filePath, text, 'utf8');
	return filePath;
};

test('a missing comments file reads as an empty list', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.deepEqual(await readCommentsFile(workspaceRoot), { version: 1, comments: [] });
});

test('empty file, {}, string version, 1.5 and a non-array comments are corrupt', () => {
	assert.throws(() => parseCommentsFile(JSON.parse('{}') as unknown), CorruptCommentsError);
	assert.throws(() => parseCommentsFile({ version: '1' }), CorruptCommentsError);
	assert.throws(() => parseCommentsFile({ version: 1.5, comments: [] }), CorruptCommentsError);
	assert.throws(() => parseCommentsFile({ version: 1, comments: {} }), CorruptCommentsError);
});

test('an empty comments file on disk is corrupt', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeComments(workspaceRoot, '');
	await assert.rejects(readCommentsFile(workspaceRoot), CorruptCommentsError);
});

test('version 2 is unsupported', () => {
	assert.throws(
		() => parseCommentsFile({ version: 2, comments: [] }),
		UnsupportedCommentsVersionError,
	);
});

test('duplicate comment ids and duplicate reply ids are corrupt', () => {
	assert.throws(
		() =>
			parseCommentsFile({
				version: 1,
				comments: [validComment(), validComment({ id: 'c1', selector: 'p' })],
			}),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile({
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

test('oversized, empty, and empty-reply bodies are corrupt', () => {
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ body: 'x'.repeat(2001) })] }),
		CorruptCommentsError,
	);
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ body: '' })] }),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile({
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

test('over the comment count or reply cap is corrupt', () => {
	const comments = Array.from({ length: MAX_COMMENTS + 1 }, (_, index) =>
		validComment({ id: `c${index}` }),
	);
	assert.throws(() => parseCommentsFile({ version: 1, comments }), CorruptCommentsError);
	const replies = Array.from({ length: MAX_COMMENT_REPLIES + 1 }, (_, index) => ({
		id: `r${index}`,
		author: 'user',
		body: 'note',
		createdAt: CREATED_AT,
	}));
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ replies })] }),
		CorruptCommentsError,
	);
});

test('a non-hash fingerprint, newline selector, and upper-case tagName are corrupt', () => {
	assert.throws(
		() =>
			parseCommentsFile({ version: 1, comments: [validComment({ targetFingerprint: 'nope' })] }),
		CorruptCommentsError,
	);
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ selector: 'h1\n' })] }),
		CorruptCommentsError,
	);
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ tagName: 'H1' })] }),
		CorruptCommentsError,
	);
});

test('an element comment with null rect and a page comment that is not body are corrupt', () => {
	assert.throws(
		() => parseCommentsFile({ version: 1, comments: [validComment({ rect: null })] }),
		CorruptCommentsError,
	);
	assert.throws(
		() =>
			parseCommentsFile({
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

test('unknown fields, bad styles, oversize pin and upper-case hashes load', () => {
	const parsed = parseCommentsFile({
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

test('serialize then parse keeps the documented key order', () => {
	const file = parseCommentsFile({ version: 1, comments: [validComment()] });
	const roundTrip = parseCommentsFile(JSON.parse(serializeCommentsFile(file)) as unknown);
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

test('an agreeing element pick stores a fingerprint', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({ workspaceRoot, comment: pick() });
	assert.ok(comment.targetFingerprint?.startsWith('sha256:'));
	assert.equal(comment.status, 'open');
	assert.match(comment.id, /^[0-9a-f-]{36}$/i);
	assert.ok(!Number.isNaN(Date.parse(comment.createdAt)));
});

test('tag mismatch, text mismatch, 0 matches and 2+ matches store no fingerprint', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot, {
		html: '<!DOCTYPE html><html><body><h1>Hello</h1><h1>Hello</h1></body></html>',
	});
	const cases: NewComment[] = [
		pick({ tagName: 'p' }),
		pick({ text: 'Nope' }),
		pick({ selector: 'h2', tagName: 'h2', text: '' }),
		pick({ selector: 'h1' }),
	];
	for (const comment of cases) {
		const stored = await addComment({ workspaceRoot, comment });
		assert.equal(stored.targetFingerprint, undefined);
	}
});

test('a page comment has no fingerprint', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		workspaceRoot,
		comment: pick({ isPage: true, selector: 'body', tagName: 'body', text: '', rect: null }),
	});
	assert.equal(comment.targetFingerprint, undefined);
	assert.equal(comment.isPage, true);
});

test('a generation mismatch throws PickOutdatedError and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await assert.rejects(
		addComment({ workspaceRoot, comment: pick({ generation: 2 }) }),
		PickOutdatedError,
	);
	assert.equal(
		await readFile(join(workspaceRoot, ...commentsPathSegments), 'utf8').catch(() => 'missing'),
		'missing',
	);
});

test('a missing frame throws ArtboardNotFoundError', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(addComment({ workspaceRoot, comment: pick() }), ArtboardNotFoundError);
});

test('an empty body on a missing frame throws InvalidArgsError', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(
		addComment({ workspaceRoot, comment: pick({ body: '   ' }) }),
		InvalidArgsError,
	);
});

test('at MAX_COMMENTS addComment throws and the file is unchanged', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comments = Array.from({ length: MAX_COMMENTS }, (_, index) =>
		validComment({ id: `c${index}` }),
	);
	const before = commentsFileOf(comments);
	await writeComments(workspaceRoot, before);
	await assert.rejects(addComment({ workspaceRoot, comment: pick() }), (error: unknown) => {
		assert.ok(error instanceof InvalidArgsError);
		assert.match(error.message, /500 comments/);
		return true;
	});
	assert.equal(await readFile(join(workspaceRoot, ...commentsPathSegments), 'utf8'), before);
});

test('the body is stored trimmed and the pin is clamped', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		workspaceRoot,
		comment: pick({ body: '  Hello  ', pin: { x: 1.5, y: -1 } }),
	});
	assert.equal(comment.body, 'Hello');
	assert.deepEqual(comment.pin, { x: 1, y: 0 });
});

test('two addComment calls in parallel both land with distinct ids', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const [first, second] = await Promise.all([
		addComment({ workspaceRoot, comment: pick({ body: 'one' }) }),
		addComment({ workspaceRoot, comment: pick({ body: 'two' }) }),
	]);
	assert.notEqual(first.id, second.id);
	const listed = await listComments({ workspaceRoot });
	assert.equal(listed.comments.length, 2);
});

test('artboard title, empty title, missing meta, newline title and version', async () => {
	const titled = await makeTempRoot();
	await seedHero(titled, { title: 'Landing page' });
	assert.equal(
		(await addComment({ workspaceRoot: titled, comment: pick() })).artboard,
		'Landing page',
	);

	const emptyTitle = await makeTempRoot();
	await seedHero(emptyTitle, { title: '' });
	assert.equal((await addComment({ workspaceRoot: emptyTitle, comment: pick() })).artboard, 'hero');

	const noMeta = await makeTempRoot();
	await seedHero(noMeta, { title: 'Gone' });
	await unlink(join(noMeta, ...artboardMetaPathSegments('hero')));
	assert.equal((await addComment({ workspaceRoot: noMeta, comment: pick() })).artboard, 'hero');

	const newline = await makeTempRoot();
	await seedHero(newline, { title: 'Line\nBreak' });
	const stored = await addComment({ workspaceRoot: newline, comment: pick() });
	assert.equal(stored.artboard, 'Line Break');
	assert.equal(stored.version, 1);
});

test('corrupt and version-2 files are never overwritten', async () => {
	const payloads = ['{', commentsFileOf([]).replace('"version": 1', '"version": 2')];
	for (const payload of payloads) {
		const workspaceRoot = await makeTempRoot();
		await seedHero(workspaceRoot);
		const filePath = await writeComments(workspaceRoot, payload);
		const ops = [
			() => addComment({ workspaceRoot, comment: pick() }),
			() => replyToComment({ workspaceRoot, id: 'c1', body: 'x' }),
			() => setCommentStatus({ workspaceRoot, id: 'c1', status: 'resolved' }),
			() => markCommentsSent({ workspaceRoot, ids: ['c1'] }),
			() => resolveComment({ workspaceRoot, id: 'c1', note: 'done' }),
		];
		for (const op of ops) {
			await assert.rejects(op);
			assert.equal(await readFile(filePath, 'utf8'), payload);
		}
	}
});

test('resolve and reply on a workspace with no .cursor-design create nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(
		resolveComment({ workspaceRoot, id: 'c1', note: 'done' }),
		CommentNotFoundError,
	);
	await assert.rejects(
		replyToComment({ workspaceRoot, id: 'c1', body: 'hi' }),
		CommentNotFoundError,
	);
	assert.deepEqual(await readdir(workspaceRoot), []);
});

test('setCommentStatus rejects sent and applies the status machine', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({ workspaceRoot, comment: pick() });
	await assert.rejects(
		setCommentStatus({ workspaceRoot, id: comment.id, status: 'sent' }),
		InvalidArgsError,
	);
	assert.equal(
		(await setCommentStatus({ workspaceRoot, id: comment.id, status: 'resolved' })).status,
		'resolved',
	);
	assert.equal(
		(await setCommentStatus({ workspaceRoot, id: comment.id, status: 'open' })).status,
		'open',
	);
	await markCommentsSent({ workspaceRoot, ids: [comment.id] });
	assert.equal(
		(await setCommentStatus({ workspaceRoot, id: comment.id, status: 'resolved' })).status,
		'resolved',
	);
});

test('open to open and resolved to resolved do not write', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({ workspaceRoot, comment: pick() });
	const filePath = join(workspaceRoot, ...commentsPathSegments);
	const before = await readFile(filePath, 'utf8');
	const mtime = (await lstat(filePath)).mtimeMs;
	await setCommentStatus({ workspaceRoot, id: comment.id, status: 'open' });
	assert.equal(await readFile(filePath, 'utf8'), before);
	assert.equal((await lstat(filePath)).mtimeMs, mtime);
	await setCommentStatus({ workspaceRoot, id: comment.id, status: 'resolved' });
	await setCommentStatus({ workspaceRoot, id: comment.id, status: 'resolved' });
	const resolvedBytes = await readFile(filePath, 'utf8');
	const resolvedMtime = (await lstat(filePath)).mtimeMs;
	await setCommentStatus({ workspaceRoot, id: comment.id, status: 'resolved' });
	assert.equal(await readFile(filePath, 'utf8'), resolvedBytes);
	assert.equal((await lstat(filePath)).mtimeMs, resolvedMtime);
});

test('resolveComment on resolved throws, appends a trimmed agent reply otherwise', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({ workspaceRoot, comment: pick() });
	const resolved = await resolveComment({ workspaceRoot, id: comment.id, note: '  bolded  ' });
	assert.equal(resolved.status, 'resolved');
	assert.equal(resolved.replies.at(-1)?.author, 'agent');
	assert.equal(resolved.replies.at(-1)?.body, 'bolded');
	await assert.rejects(
		resolveComment({ workspaceRoot, id: comment.id, note: 'again' }),
		CommentResolvedError,
	);
});

test('markCommentsSent marks only open comments and skips unknown ids', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const openComment = await addComment({ workspaceRoot, comment: pick({ body: 'open' }) });
	const extra = await addComment({ workspaceRoot, comment: pick({ body: 'extra' }) });
	await setCommentStatus({ workspaceRoot, id: extra.id, status: 'resolved' });
	const marked = await markCommentsSent({
		workspaceRoot,
		ids: [openComment.id, extra.id, 'missing'],
	});
	assert.deepEqual(
		marked.map((comment) => comment.id),
		[openComment.id],
	);
	assert.equal((await getComment({ workspaceRoot, id: openComment.id })).status, 'sent');
	assert.equal((await getComment({ workspaceRoot, id: extra.id })).status, 'resolved');
});

test('resolved is not re-sent', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({ workspaceRoot, comment: pick() });
	await resolveComment({ workspaceRoot, id: comment.id, note: 'done' });
	assert.deepEqual(await markCommentsSent({ workspaceRoot, ids: [comment.id] }), []);
	assert.equal((await getComment({ workspaceRoot, id: comment.id })).status, 'resolved');
});

test('replyToComment keeps the status', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({ workspaceRoot, comment: pick() });
	await markCommentsSent({ workspaceRoot, ids: [comment.id] });
	const replied = await replyToComment({ workspaceRoot, id: comment.id, body: 'more' });
	assert.equal(replied.status, 'sent');
	assert.equal(replied.replies.at(-1)?.author, 'user');
});

test('reply cap leaves the last slot for resolve, then thread-full', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const replies = Array.from({ length: MAX_COMMENT_REPLIES - 1 }, (_, index) => ({
		id: `r${index}`,
		author: 'user',
		body: 'note',
		createdAt: CREATED_AT,
	}));
	await writeComments(workspaceRoot, commentsFileOf([validComment({ replies })]));
	await assert.rejects(
		replyToComment({ workspaceRoot, id: 'c1', body: 'one more' }),
		InvalidArgsError,
	);
	const resolved = await resolveComment({ workspaceRoot, id: 'c1', note: 'done' });
	assert.equal(resolved.replies.length, MAX_COMMENT_REPLIES);
	await writeComments(
		workspaceRoot,
		commentsFileOf([
			validComment({
				status: 'open',
				replies: [...replies, { id: 'rlast', author: 'user', body: 'full', createdAt: CREATED_AT }],
			}),
		]),
	);
	await assert.rejects(
		resolveComment({ workspaceRoot, id: 'c1', note: 'done' }),
		(error: unknown) => {
			assert.ok(error instanceof InvalidArgsError);
			assert.match(error.message, /thread is full/);
			return true;
		},
	);
});

test('deleted HTML is targetMissing; a page comment stays not stale', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const element = await addComment({ workspaceRoot, comment: pick() });
	const page = await addComment({
		workspaceRoot,
		comment: pick({
			body: 'whole page',
			isPage: true,
			selector: 'body',
			tagName: 'body',
			text: '',
			rect: null,
		}),
	});
	await unlink(join(workspaceRoot, ...artboardHtmlPathSegments('hero')));
	const missing = await getComment({ workspaceRoot, id: element.id });
	assert.equal(missing.targetMissing, true);
	assert.equal(missing.hint, HINT_FRAME_MISSING);
	const pageView = await getComment({ workspaceRoot, id: page.id });
	assert.equal(pageView.stale, false);
	assert.equal(pageView.targetMissing, true);
});

// The frame-missing rule comes before the no-fingerprint rule: an unchecked comment whose frame
// was deleted is reported missing, not "cannot be checked".
test('an unchecked comment on a deleted frame is targetMissing', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const unchecked = await addComment({ workspaceRoot, comment: pick({ tagName: 'p' }) });
	assert.equal(unchecked.targetFingerprint, undefined);
	await unlink(join(workspaceRoot, ...artboardHtmlPathSegments('hero')));
	const view = await getComment({ workspaceRoot, id: unchecked.id });
	assert.equal(view.targetMissing, true);
	assert.equal(view.hint, HINT_FRAME_MISSING);
});

test('an added comment is written in the documented key order', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ workspaceRoot, comment: pick() });
	const written = JSON.parse(
		await readFile(join(workspaceRoot, ...commentsPathSegments), 'utf8'),
	) as { comments: Record<string, unknown>[] };
	assert.deepEqual(Object.keys(written.comments[0] ?? {}), Object.keys(validComment()));
});

test('an unreadable frame still lists every comment', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await createArtboard({
		workspaceRoot,
		artboardId: 'other',
		html: '<p>other</p>',
		writeEnsurePanelMarker: false,
	});
	const heroComment = await addComment({ workspaceRoot, comment: pick() });
	const otherComment = await addComment({
		workspaceRoot,
		comment: pick({ frameId: 'other', selector: 'p', tagName: 'p', text: 'other', body: 'other' }),
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments('hero'));
	const html = await readFile(htmlPath, 'utf8');
	await unlink(htmlPath);
	const target = join(workspaceRoot, 'elsewhere.html');
	await writeFile(target, html, 'utf8');
	await symlink(target, htmlPath);
	const listed = await listComments({ workspaceRoot });
	assert.equal(listed.comments.length, 2);
	const heroView = listed.comments.find((comment) => comment.id === heroComment.id);
	const otherView = listed.comments.find((comment) => comment.id === otherComment.id);
	assert.equal(heroView?.hint, HINT_FRAME_UNREADABLE);
	assert.notEqual(otherView?.hint, HINT_FRAME_UNREADABLE);
});

test('listComments filters by status and rejects a bad status', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const openComment = await addComment({ workspaceRoot, comment: pick({ body: 'open' }) });
	const sentComment = await addComment({ workspaceRoot, comment: pick({ body: 'sent' }) });
	const resolvedComment = await addComment({ workspaceRoot, comment: pick({ body: 'resolved' }) });
	await markCommentsSent({ workspaceRoot, ids: [sentComment.id] });
	await setCommentStatus({ workspaceRoot, id: resolvedComment.id, status: 'resolved' });
	assert.deepEqual(
		(await listComments({ workspaceRoot })).comments.map((comment) => comment.id),
		[openComment.id, sentComment.id],
	);
	assert.deepEqual(
		(await listComments({ workspaceRoot, status: 'open' })).comments.map((comment) => comment.id),
		[openComment.id],
	);
	assert.deepEqual(
		(await listComments({ workspaceRoot, status: 'sent' })).comments.map((comment) => comment.id),
		[sentComment.id],
	);
	assert.deepEqual(
		(await listComments({ workspaceRoot, status: 'resolved' })).comments.map(
			(comment) => comment.id,
		),
		[resolvedComment.id],
	);
	await assert.rejects(listComments({ workspaceRoot, status: 'nope' }), InvalidArgsError);
});

test('an unchecked stored comment keeps HINT_UNCHECKED', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await writeComments(
		workspaceRoot,
		commentsFileOf([validComment({ targetFingerprint: undefined })]),
	);
	const view = await getComment({ workspaceRoot, id: 'c1' });
	assert.equal(view.stale, null);
	assert.equal(view.targetMissing, null);
	assert.equal(view.hint, HINT_UNCHECKED);
});

test('a no-file workspace has no lock file after a missing-comment read', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(getComment({ workspaceRoot, id: 'c1' }), CommentNotFoundError);
	assert.deepEqual(await readdir(workspaceRoot), []);
});
