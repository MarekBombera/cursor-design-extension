import assert from 'node:assert/strict';
import {
	chmod,
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
import { afterEach, test, vi } from 'vite-plus/test';

import { createArtboard } from './artboardFs';
import {
	addComment,
	getComment,
	listComments,
	markCommentsSent,
	readComments,
	replyToComment,
	resolveComment,
	setCommentStatus,
} from './comments';
import { cachedArtboardDocument } from './commentViews';
import { COMMENT_BODY_MESSAGE, type NewComment } from './commentsFile';
import { HINT_CHECK_BUDGET, parseArtboardDocument } from './commentTarget';
import {
	ArtboardNotFoundError,
	CommentNotFoundError,
	CommentResolvedError,
	DiskError,
	InvalidArgsError,
	PickOutdatedError,
} from './errors';
import {
	FIRST_PAGE_ID,
	COMMENTS_SCHEMA_VERSION,
	CURSOR_DESIGN_DIR,
	MAX_COMMENT_BODY_CHARS,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	commentsPathSegments,
} from './layout';
import { resolveOpenPage } from './openPage';

// Pinned values: the module keeps these private.
const MAX_PARSED_DOCUMENTS = 32;
const HINT_FRAME_MISSING = "The frame's artboard no longer exists.";
const HINT_FRAME_UNREADABLE = "The frame's artboard file cannot be read.";
const HINT_UNCHECKED =
	'The target is generated or changed by script; it cannot be checked from disk.';

// The real parser behind a counter, so the parse cache's reuse and eviction are observable.
vi.mock('./commentTarget', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./commentTarget')>();
	return { ...actual, parseArtboardDocument: vi.fn(actual.parseArtboardDocument) };
});

const parseCount = (): number => vi.mocked(parseArtboardDocument).mock.calls.length;

const tempRoots: string[] = [];

// Seeded by default; { seeded: false } is a fresh workspace with no .cursor-design.
const makeTempRoot = async ({ seeded = true }: { seeded?: boolean } = {}): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-comments-'));
	tempRoots.push(workspaceRoot);
	if (seeded) {
		await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	}
	return workspaceRoot;
};

afterEach(async () => {
	vi.restoreAllMocks();
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
	const filePath = join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID));
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR), { recursive: true });
	await writeFile(filePath, text, 'utf8');
	return filePath;
};

test('an agreeing element pick stores a fingerprint', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
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
		const stored = await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment });
		assert.equal(stored.targetFingerprint, undefined);
	}
});

test('a page comment has no fingerprint', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ isPage: true, selector: 'body', tagName: 'body', text: '', rect: null }),
	});
	assert.equal(comment.targetFingerprint, undefined);
	assert.equal(comment.isPage, true);
});

test('a generation mismatch throws PickOutdatedError and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await assert.rejects(
		addComment({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			comment: pick({ generation: 2 }),
		}),
		PickOutdatedError,
	);
	assert.equal(
		await readFile(join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID)), 'utf8').catch(
			() => 'missing',
		),
		'missing',
	);
});

test('a missing frame throws ArtboardNotFoundError', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(
		addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() }),
		ArtboardNotFoundError,
	);
});

// validateNewComment is the only guard before the write: an invalid comment would brick comments.json.
test('invalid new-comment fields are INVALID_ARGS and write no comments.json', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const fieldsMessage = 'Comment fields are invalid. Pick the element again.';
	const cases: [Partial<NewComment>, string][] = [
		[{ body: '   ' }, COMMENT_BODY_MESSAGE],
		[{ rect: null }, fieldsMessage],
		[{ isPage: true, selector: 'p', tagName: 'body', rect: null }, fieldsMessage],
		[{ tagName: 'P!' }, fieldsMessage],
		[{ generation: 0 }, fieldsMessage],
	];
	for (const [overrides, message] of cases) {
		await assert.rejects(
			addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick(overrides) }),
			(error: unknown) => error instanceof InvalidArgsError && error.message === message,
			JSON.stringify(overrides),
		);
	}
	await assert.rejects(readFile(join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID))), {
		code: 'ENOENT',
	});
});

test('at MAX_COMMENTS addComment throws and the file is unchanged', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comments = Array.from({ length: MAX_COMMENTS }, (_, index) =>
		validComment({ id: `c${index}` }),
	);
	const before = commentsFileOf(comments);
	await writeComments(workspaceRoot, before);
	await assert.rejects(
		addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() }),
		(error: unknown) => {
			assert.ok(error instanceof InvalidArgsError);
			assert.equal(
				error.message,
				'comments.json already holds 500 comments. Remove resolved comments from .cursor-design/pages/page-1/comments.json, then retry.',
			);
			return true;
		},
	);
	assert.equal(
		await readFile(join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID)), 'utf8'),
		before,
	);
});

test('the body is stored trimmed and the pin is clamped', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ body: '  Hello  ', pin: { x: 1.5, y: -1 } }),
	});
	assert.equal(comment.body, 'Hello');
	assert.deepEqual(comment.pin, { x: 1, y: 0 });
});

test('two addComment calls in parallel both land with distinct ids', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const [first, second] = await Promise.all([
		addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick({ body: 'one' }) }),
		addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick({ body: 'two' }) }),
	]);
	assert.notEqual(first.id, second.id);
	const listed = await listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(listed.comments.length, 2);
});

test('artboard title, empty title, missing meta, newline title and version', async () => {
	const titled = await makeTempRoot();
	await seedHero(titled, { title: 'Landing page' });
	assert.equal(
		(await addComment({ page: { workspaceRoot: titled, pageId: FIRST_PAGE_ID }, comment: pick() }))
			.artboard,
		'Landing page',
	);

	const emptyTitle = await makeTempRoot();
	await seedHero(emptyTitle, { title: '' });
	assert.equal(
		(
			await addComment({
				page: { workspaceRoot: emptyTitle, pageId: FIRST_PAGE_ID },
				comment: pick(),
			})
		).artboard,
		'hero',
	);

	const noMeta = await makeTempRoot();
	await seedHero(noMeta, { title: 'Gone' });
	await unlink(join(noMeta, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero')));
	assert.equal(
		(await addComment({ page: { workspaceRoot: noMeta, pageId: FIRST_PAGE_ID }, comment: pick() }))
			.artboard,
		'hero',
	);

	const newline = await makeTempRoot();
	await seedHero(newline, { title: 'Line\nBreak' });
	const stored = await addComment({
		page: { workspaceRoot: newline, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
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
			() => addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() }),
			() => replyToComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', body: 'x' }),
			() =>
				setCommentStatus({
					page: { workspaceRoot, pageId: FIRST_PAGE_ID },
					id: 'c1',
					status: 'resolved',
				}),
			() => markCommentsSent({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, ids: ['c1'] }),
			() =>
				resolveComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', note: 'done' }),
		];
		for (const op of ops) {
			await assert.rejects(op);
			assert.equal(await readFile(filePath, 'utf8'), payload);
		}
	}
});

test('resolve, reply, status and mark-sent on a workspace with no .cursor-design create nothing', async () => {
	const workspaceRoot = await makeTempRoot({ seeded: false });
	await assert.rejects(
		resolveComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', note: 'done' }),
		CommentNotFoundError,
	);
	await assert.rejects(
		replyToComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', body: 'hi' }),
		CommentNotFoundError,
	);
	await assert.rejects(
		setCommentStatus({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', status: 'open' }),
		CommentNotFoundError,
	);
	assert.deepEqual(
		await markCommentsSent({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, ids: ['c1'] }),
		[],
	);
	assert.deepEqual(await readdir(workspaceRoot), []);
});

test('setCommentStatus rejects sent and applies the status machine', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	await assert.rejects(
		setCommentStatus({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			id: comment.id,
			status: 'sent',
		}),
		InvalidArgsError,
	);
	assert.equal(
		(
			await setCommentStatus({
				page: { workspaceRoot, pageId: FIRST_PAGE_ID },
				id: comment.id,
				status: 'resolved',
			})
		).status,
		'resolved',
	);
	assert.equal(
		(
			await setCommentStatus({
				page: { workspaceRoot, pageId: FIRST_PAGE_ID },
				id: comment.id,
				status: 'open',
			})
		).status,
		'open',
	);
	await markCommentsSent({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, ids: [comment.id] });
	assert.equal(
		(
			await setCommentStatus({
				page: { workspaceRoot, pageId: FIRST_PAGE_ID },
				id: comment.id,
				status: 'resolved',
			})
		).status,
		'resolved',
	);
});

test('open to open and resolved to resolved do not write', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	const filePath = join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID));
	const before = await readFile(filePath, 'utf8');
	const mtime = (await lstat(filePath)).mtimeMs;
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		status: 'open',
	});
	assert.equal(await readFile(filePath, 'utf8'), before);
	assert.equal((await lstat(filePath)).mtimeMs, mtime);
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		status: 'resolved',
	});
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		status: 'resolved',
	});
	const resolvedBytes = await readFile(filePath, 'utf8');
	const resolvedMtime = (await lstat(filePath)).mtimeMs;
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		status: 'resolved',
	});
	assert.equal(await readFile(filePath, 'utf8'), resolvedBytes);
	assert.equal((await lstat(filePath)).mtimeMs, resolvedMtime);
});

test('resolveComment on resolved throws, appends a trimmed agent reply otherwise', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	const resolved = await resolveComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		note: '  bolded  ',
	});
	assert.equal(resolved.status, 'resolved');
	assert.equal(resolved.replies.at(-1)?.author, 'agent');
	assert.equal(resolved.replies.at(-1)?.body, 'bolded');
	await assert.rejects(
		resolveComment({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			id: comment.id,
			note: 'again',
		}),
		CommentResolvedError,
	);
});

test('markCommentsSent marks only open comments and skips unknown ids', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const openComment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ body: 'open' }),
	});
	const extra = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ body: 'extra' }),
	});
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: extra.id,
		status: 'resolved',
	});
	const marked = await markCommentsSent({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		ids: [openComment.id, extra.id, 'missing'],
	});
	assert.deepEqual(
		marked.map((comment) => comment.id),
		[openComment.id],
	);
	assert.equal(
		(await getComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: openComment.id }))
			.status,
		'sent',
	);
	assert.equal(
		(await getComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: extra.id })).status,
		'resolved',
	);
});

test('resolved is not re-sent', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	await resolveComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		note: 'done',
	});
	assert.deepEqual(
		await markCommentsSent({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, ids: [comment.id] }),
		[],
	);
	assert.equal(
		(await getComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: comment.id })).status,
		'resolved',
	);
});

test('replyToComment keeps the status', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const comment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	await markCommentsSent({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, ids: [comment.id] });
	const replied = await replyToComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		body: 'more',
	});
	assert.equal(replied.status, 'sent');
	assert.equal(replied.replies.at(-1)?.author, 'user');

	// The disk is the only body guard: an empty or oversize reply would make the next read corrupt.
	const commentsPath = join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID));
	const before = await readFile(commentsPath, 'utf8');
	for (const body of ['   ', 42, 'x'.repeat(MAX_COMMENT_BODY_CHARS + 1)]) {
		await assert.rejects(
			replyToComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: comment.id, body }),
			(error: unknown) =>
				error instanceof InvalidArgsError && error.message === COMMENT_BODY_MESSAGE,
			String(body).slice(0, 8),
		);
		assert.equal(await readFile(commentsPath, 'utf8'), before);
	}
	const longest = 'x'.repeat(MAX_COMMENT_BODY_CHARS);
	const atLimit = await replyToComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: comment.id,
		body: `  ${longest}  `,
	});
	assert.equal(atLimit.replies.at(-1)?.body, longest);
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
		replyToComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', body: 'one more' }),
		InvalidArgsError,
	);
	const resolved = await resolveComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'c1',
		note: 'done',
	});
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
		resolveComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1', note: 'done' }),
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
	const element = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	const page = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({
			body: 'whole page',
			isPage: true,
			selector: 'body',
			tagName: 'body',
			text: '',
			rect: null,
		}),
	});
	await unlink(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')));
	const missing = await getComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: element.id,
	});
	assert.equal(missing.targetMissing, true);
	assert.equal(missing.hint, HINT_FRAME_MISSING);
	const pageView = await getComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: page.id,
	});
	assert.equal(pageView.stale, false);
	assert.equal(pageView.targetMissing, true);
});

// The frame-missing rule comes before the no-fingerprint rule: an unchecked comment whose frame
// was deleted is reported missing, not "cannot be checked".
test('an unchecked comment on a deleted frame is targetMissing', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const unchecked = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ tagName: 'p' }),
	});
	assert.equal(unchecked.targetFingerprint, undefined);
	await unlink(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')));
	const view = await getComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: unchecked.id,
	});
	assert.equal(view.targetMissing, true);
	assert.equal(view.hint, HINT_FRAME_MISSING);
});

test('an added comment is written in the documented key order', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	const written = JSON.parse(
		await readFile(join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID)), 'utf8'),
	) as { comments: Record<string, unknown>[] };
	assert.deepEqual(Object.keys(written.comments[0] ?? {}), Object.keys(validComment()));
});

test('an unreadable frame still lists every comment', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'other',
		html: '<p>other</p>',
		writeEnsurePanelMarker: false,
	});
	const heroComment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	const otherComment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ frameId: 'other', selector: 'p', tagName: 'p', text: 'other', body: 'other' }),
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	const html = await readFile(htmlPath, 'utf8');
	await unlink(htmlPath);
	const target = join(workspaceRoot, 'elsewhere.html');
	await writeFile(target, html, 'utf8');
	await symlink(target, htmlPath);
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const listed = await listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.ok(
		stderr.mock.calls.some(([line]) =>
			String(line).startsWith('cursor-design: comment target read failed: '),
		),
	);
	assert.equal(listed.comments.length, 2);
	const heroView = listed.comments.find((comment) => comment.id === heroComment.id);
	const otherView = listed.comments.find((comment) => comment.id === otherComment.id);
	assert.equal(heroView?.hint, HINT_FRAME_UNREADABLE);
	assert.notEqual(otherView?.hint, HINT_FRAME_UNREADABLE);
});

test('listComments filters by status and rejects a bad status', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const openComment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ body: 'open' }),
	});
	const sentComment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ body: 'sent' }),
	});
	const resolvedComment = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ body: 'resolved' }),
	});
	await markCommentsSent({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, ids: [sentComment.id] });
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: resolvedComment.id,
		status: 'resolved',
	});
	assert.deepEqual(
		(await listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } })).comments.map(
			(comment) => comment.id,
		),
		[openComment.id, sentComment.id],
	);
	assert.deepEqual(
		(
			await listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, status: 'open' })
		).comments.map((comment) => comment.id),
		[openComment.id],
	);
	assert.deepEqual(
		(
			await listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, status: 'sent' })
		).comments.map((comment) => comment.id),
		[sentComment.id],
	);
	assert.deepEqual(
		(
			await listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, status: 'resolved' })
		).comments.map((comment) => comment.id),
		[resolvedComment.id],
	);
	await assert.rejects(
		listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, status: 'nope' }),
		InvalidArgsError,
	);
});

test('an unchecked stored comment keeps HINT_UNCHECKED', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await writeComments(
		workspaceRoot,
		commentsFileOf([validComment({ targetFingerprint: undefined })]),
	);
	const view = await getComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1' });
	assert.equal(view.stale, null);
	assert.equal(view.targetMissing, null);
	assert.equal(view.hint, HINT_UNCHECKED);
});

test('a no-file workspace has no lock file after a missing-comment read', async () => {
	const workspaceRoot = await makeTempRoot({ seeded: false });
	await assert.rejects(
		getComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, id: 'c1' }),
		CommentNotFoundError,
	);
	assert.deepEqual(await readdir(workspaceRoot), []);
});

test('readComments returns every comment, resolved included, and [] without a file', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.deepEqual(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }), []);
	await writeComments(workspaceRoot, commentsFileOf([validComment({ status: 'resolved' })]));
	assert.deepEqual(
		(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } })).map(
			(comment) => comment.status,
		),
		['resolved'],
	);
});

test('readComments refuses a symlinked .cursor-design like listComments', async () => {
	const workspaceRoot = await makeTempRoot({ seeded: false });
	const elsewhere = await makeTempRoot();
	await writeComments(elsewhere, commentsFileOf([validComment()]));
	await symlink(join(elsewhere, CURSOR_DESIGN_DIR), join(workspaceRoot, CURSOR_DESIGN_DIR));
	await assert.rejects(readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }), DiskError);
	await assert.rejects(listComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }), DiskError);
});

const PAGE_PICK: Partial<NewComment> = {
	body: 'whole page',
	isPage: true,
	selector: 'body',
	tagName: 'body',
	text: '',
	rect: null,
};

const flagsOf = (comment: {
	stale: boolean | null;
	targetMissing: boolean | null;
	hint?: string;
}): { stale: boolean | null; targetMissing: boolean | null; hint?: string } =>
	comment.hint === undefined
		? { stale: comment.stale, targetMissing: comment.targetMissing }
		: { stale: comment.stale, targetMissing: comment.targetMissing, hint: comment.hint };

test('readComments flags resolved comments too', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	const added = await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick(),
	});
	await setCommentStatus({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: added.id,
		status: 'resolved',
	});
	const [view] = await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(view?.status, 'resolved');
	assert.deepEqual(view && flagsOf(view), { stale: false, targetMissing: false });
});

// The parse cache is keyed by the HTML text, so an edit between two reads is never missed.
test('an edit inside the target between two reads flips stale', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	assert.equal(
		(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }))[0]?.stale,
		false,
	);
	await writeFile(
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')),
		HERO_HTML.replace('<h1>Hello</h1>', '<h1>Hello there</h1>'),
		'utf8',
	);
	assert.equal(
		(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }))[0]?.stale,
		true,
	);
});

test('an unchanged frame is parsed once across reads, and again after an edit', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	const before = parseCount();
	await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(parseCount() - before, 1);
	await writeFile(
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')),
		HERO_HTML.replace('<h1>Hello</h1>', '<h1>Hello there</h1>'),
		'utf8',
	);
	await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(parseCount() - before, 2);
});

test('cachedArtboardDocument and a later flag read share one parse', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	const html = await readFile(
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')),
		'utf8',
	);
	const before = parseCount();
	cachedArtboardDocument({ workspaceRoot, pageId: FIRST_PAGE_ID, frameId: 'hero', html });
	assert.equal(
		(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }))[0]?.stale,
		false,
	);
	assert.equal(parseCount() - before, 1);
});

test('the parse cache keeps at most MAX_PARSED_DOCUMENTS frames', async () => {
	const workspaceRoot = await makeTempRoot();
	const frameIds = Array.from({ length: MAX_PARSED_DOCUMENTS + 1 }, (_, index) => `f${index}`);
	for (const artboardId of frameIds) {
		await createArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			artboardId,
			html: HERO_HTML,
			writeEnsurePanelMarker: false,
		});
	}
	await writeComments(
		workspaceRoot,
		commentsFileOf(frameIds.map((frameId) => validComment({ id: `c-${frameId}`, frameId }))),
	);
	await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	const before = parseCount();
	// The first frame was evicted by the last one, so the second read parses it again.
	await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.ok(parseCount() > before);
});

test('a deleted frame is targetMissing and a re-created one is checked again', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	assert.equal(
		(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }))[0]?.targetMissing,
		false,
	);
	await unlink(htmlPath);
	assert.equal(
		(await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }))[0]?.targetMissing,
		true,
	);
	await writeFile(htmlPath, HERO_HTML, 'utf8');
	const [view] = await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.deepEqual(view && flagsOf(view), { stale: false, targetMissing: false });
});

test('an lstat failure on a page comment frame reads as unchecked, never a rejected read', async (context) => {
	if (process.getuid?.() === 0) {
		context.skip('root ignores chmod');
		return;
	}
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick(PAGE_PICK) });
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const artboardsDir = join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID));
	await chmod(artboardsDir, 0o000);
	let views: Awaited<ReturnType<typeof readComments>>;
	try {
		views = await readComments({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	} finally {
		await chmod(artboardsDir, 0o755);
	}
	assert.equal(views.length, 2);
	const page = views.find((view) => view.isPage);
	assert.deepEqual(page && flagsOf(page), {
		stale: null,
		targetMissing: null,
		hint: HINT_FRAME_UNREADABLE,
	});
	assert.ok(stderr.mock.calls.length > 0);
});

test('past the check budget a fingerprinted comment is unchecked; a page comment is not', async () => {
	const workspaceRoot = await makeTempRoot();
	await seedHero(workspaceRoot);
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick() });
	await addComment({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		comment: pick({ selector: 'p', tagName: 'p', text: 'World', body: 'second' }),
	});
	await addComment({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, comment: pick(PAGE_PICK) });
	// The read's start and the first check see 0 ms; every later check is far past the budget.
	let calls = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => {
		calls += 1;
		return calls <= 2 ? 0 : 1000;
	});
	const [first, second, page] = await readComments({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
	});
	assert.equal(second?.targetFingerprint === undefined, false);
	assert.deepEqual(first && flagsOf(first), { stale: false, targetMissing: false });
	assert.deepEqual(second && flagsOf(second), {
		stale: null,
		targetMissing: null,
		hint: HINT_CHECK_BUDGET,
	});
	assert.deepEqual(page && flagsOf(page), { stale: false, targetMissing: false });
});
