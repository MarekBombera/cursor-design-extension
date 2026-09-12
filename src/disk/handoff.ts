import { normalizeHash } from './hash';
import { ARTBOARDS_DIR, CURSOR_DESIGN_DIR, artboardMetaFileName } from './layout';
import { type ArtboardMeta, type LastExport } from './parse';

export const makeExportId = ({ artboardId, now }: { artboardId: string; now: Date }): string => {
	const compact = now.toISOString().replaceAll(/[-:.]/g, '');
	return `${artboardId}-${compact}`;
};

export type BuildHandoffFilesArgs = {
	artboardId: string;
	html: string;
	meta: ArtboardMeta;
	tokensJson: string | undefined;
	now: Date;
};

export type HandoffFiles = {
	exportId: string;
	lastExport: LastExport;
	indexHtml: string;
	implementMd: string;
	tokensJson: string;
};

const STUB_TOKENS_JSON = `${JSON.stringify({ version: 1, tokens: {} }, null, 2)}\n`;

const buildImplementMarkdown = ({
	exportId,
	artboardId,
	artboardHash,
	exportedAt,
	title,
	viewport,
	generation,
}: {
	exportId: string;
	artboardId: string;
	artboardHash: string;
	exportedAt: string;
	title: string;
	viewport: string;
	generation: number;
}): string => {
	const metaPath = `${CURSOR_DESIGN_DIR}/${ARTBOARDS_DIR}/${artboardMetaFileName(artboardId)}`;
	return `# Implement this artboard

exportId: ${exportId}
artboardId: ${artboardId}
artboardHash: ${artboardHash}
exportedAt: ${exportedAt}
title: ${title}
viewport: ${viewport}
generation: ${generation}

## Files

- index.html
- tokens.json

## Instructions

1. Call \`handoff_status\` first. If \`stale\` is true, re-export before implementing.
2. If MCP is unavailable, compare this header \`artboardHash\` with \`${metaPath}\` \`hash\`. If they differ, re-export, or ask the user to run **Export Handoff**.
3. Implement from \`index.html\` (HTML+CSS+JS live inline in that document), not from screenshots.
4. Target \`fixtures/dev-workspace/sample-app/index.html\` in the demo, or the user's named app.
5. Never copy \`.cursor-design/\` into the app.
6. Keep semantic structure, classes, and behavior.
7. Assets referenced as \`assets/...\` resolve against \`.cursor-design/assets/\`. Copy them manually.
`;
};

export const buildHandoffFiles = ({
	artboardId,
	html,
	meta,
	tokensJson,
	now,
}: BuildHandoffFilesArgs): HandoffFiles => {
	const exportedAt = now.toISOString();
	const exportId = makeExportId({ artboardId, now });
	const lastExport: LastExport = {
		exportId,
		artboardId,
		artboardHash: meta.hash,
		exportedAt,
	};
	return {
		exportId,
		lastExport,
		indexHtml: html,
		implementMd: buildImplementMarkdown({
			exportId,
			artboardId,
			artboardHash: meta.hash,
			exportedAt,
			title: meta.title,
			viewport: meta.viewport,
			generation: meta.generation,
		}),
		tokensJson: tokensJson ?? STUB_TOKENS_JSON,
	};
};

export type HandoffCompare = { exported: boolean; stale: boolean };

export const compareHandoff = ({
	lastExport,
	activeHash,
}: {
	lastExport: LastExport | undefined;
	activeHash: string;
}): HandoffCompare => {
	if (lastExport === undefined) {
		return { exported: false, stale: false };
	}
	return {
		exported: true,
		stale: normalizeHash(lastExport.artboardHash) !== normalizeHash(activeHash),
	};
};
