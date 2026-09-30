import { nextGeneration } from './generation';
import { hashHtml, normalizeHash } from './hash';
import { DEFAULT_ARTBOARD_TITLE, DEFAULT_VIEWPORT } from './layout';
import { type ArtboardMeta } from './parse';

export type EffectiveArtboardMetaArgs = {
	html: string;
	meta: ArtboardMeta | undefined;
	artboardId: string;
};

export const effectiveArtboardMeta = ({
	html,
	meta,
	artboardId,
}: EffectiveArtboardMetaArgs): ArtboardMeta => {
	const htmlHash = hashHtml(html);
	if (meta !== undefined && normalizeHash(meta.hash) === htmlHash) {
		return meta;
	}
	if (meta !== undefined) {
		return { ...meta, hash: htmlHash, generation: nextGeneration(meta.generation) };
	}
	return {
		id: artboardId,
		title: DEFAULT_ARTBOARD_TITLE,
		generation: 1,
		hash: htmlHash,
		viewport: DEFAULT_VIEWPORT,
		updatedAt: '',
	};
};
