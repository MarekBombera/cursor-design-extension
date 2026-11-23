import { type ArtboardEdit, editArtboardHtml } from './artboardEdit';
import { updateArtboard } from './artboardFs';
import { cachedArtboardDocument } from './commentViews';
import { effectiveArtboardMeta } from './effectiveMeta';
import { ConflictError, EditRefusedError, InvalidArgsError } from './errors';
import { hashHtml, isArtboardHash, normalizeHash } from './hash';
import { MAX_POSTED_ARTBOARD_HTML_CHARS } from './layout';
import {
	type PageLocation,
	assertLayoutDirsOwned,
	readStoredMeta,
	requireArtboardHtml,
	requireExactHtmlFileName,
} from './layoutFs';
import { parseArtboardId } from './parse';

// Not re-exported from artboardFs.ts: this module imports updateArtboard from there.

export type EditArtboardArgs = {
	page: PageLocation;
	artboardId: unknown;
	// The hash of the disk HTML the panel's frame was built from (canvas:updated `hash`).
	baseHash: unknown;
	edit: ArtboardEdit;
};

export type EditArtboardResult = {
	artboardId: string;
	generation: number;
	hash: string;
	// The disk HTML after the edit (never tagged).
	html: string;
	// The disk HTML the edit was checked against (the string already read, never a re-read) and its
	// normalized hash, for the undo history. Equal to `html` when the edit changed no byte.
	baseHtml: string;
	baseHash: string;
};

// The hash check, then a parse of those exact bytes before the lock; updateArtboard re-checks the
// same hash under the lock, so equal hash = the parsed bytes. Never call this while holding
// withWorkspaceLock: updateArtboard takes it and the lock is not re-entrant.
export const editArtboard = async ({
	page,
	artboardId,
	baseHash,
	edit,
}: EditArtboardArgs): Promise<EditArtboardResult> => {
	const resolvedId = parseArtboardId(artboardId);
	if (typeof baseHash !== 'string' || !isArtboardHash(baseHash)) {
		throw new InvalidArgsError('baseHash must be sha256: plus 64 hex characters.');
	}
	await assertLayoutDirsOwned(page);
	// Read first: a missing file (or artboards dir) is ArtboardNotFoundError, never a readdir
	// DiskError. Then the same refusal as updateArtboard: on a case-insensitive disk `HERO` reads
	// hero.html, and the same-bytes path below never reaches updateArtboard's own check.
	const html = await requireArtboardHtml(page, resolvedId);
	await requireExactHtmlFileName(page, resolvedId);
	// Such a frame is a tile in the panel and has no source numbers.
	if (html.length > MAX_POSTED_ARTBOARD_HTML_CHARS) {
		throw new EditRefusedError('too-large');
	}
	const actualHash = hashHtml(html);
	const expectedHash = normalizeHash(baseHash);
	if (actualHash !== expectedHash) {
		throw new ConflictError(resolvedId, { expectedHash, actualHash });
	}
	const result = editArtboardHtml({
		html,
		document: cachedArtboardDocument({
			workspaceRoot: page.workspaceRoot,
			pageId: page.pageId,
			frameId: resolvedId,
			html,
		}),
		edit,
	});
	if (!result.ok) {
		throw new EditRefusedError(result.refusal);
	}
	if (result.html.length > MAX_POSTED_ARTBOARD_HTML_CHARS) {
		throw new EditRefusedError('too-large');
	}
	if (result.html === html) {
		// Same bytes: no write, so no watcher echo and no meta bump.
		const meta = effectiveArtboardMeta({
			html,
			meta: await readStoredMeta(page, resolvedId),
			artboardId: resolvedId,
		});
		return {
			artboardId: resolvedId,
			generation: meta.generation,
			hash: actualHash,
			html,
			baseHtml: html,
			baseHash: expectedHash,
		};
	}
	const written = await updateArtboard({
		page,
		artboardId: resolvedId,
		html: result.html,
		baseHash: expectedHash,
	});
	return {
		artboardId: written.artboardId,
		generation: written.generation,
		hash: written.hash,
		html: result.html,
		baseHtml: html,
		baseHash: expectedHash,
	};
};
