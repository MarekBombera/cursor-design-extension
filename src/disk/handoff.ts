import { normalizeHash } from './hash';
import {
	ARTBOARDS_DIR,
	CANVAS_PREVIEW_FILE,
	CURSOR_DESIGN_DIR,
	HANDOFF_INDEX_FILE,
	TOKENS_FILE,
	UNGROUPED_FOLDER,
} from './layout';
import { type LastExport } from './parse';

const collapseMarkdownHeaderValue = (value: string): string => value.replaceAll(/[\r\n]+/g, ' ');

const compactIsoTime = (now: Date): string => now.toISOString().replaceAll(/[-:.]/g, '');

export const makeCanvasExportId = ({ now }: { now: Date }): string =>
	`canvas-${compactIsoTime(now)}`;

const MAX_GROUP_FOLDER_LENGTH = 64;

const EMPTY_SLUG_FOLDER = 'group';

const groupFolderSlug = (group: string): string => {
	const slug = group
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.slice(0, MAX_GROUP_FOLDER_LENGTH)
		.replace(/-+$/, '');
	return slug.length > 0 ? slug : EMPTY_SLUG_FOLDER;
};

// Frame id -> handoff folder. Group names never become paths verbatim: they are slugged,
// and `ungrouped` is reserved first when any frame has no group.
export const assignGroupFolders = (
	frames: readonly { id: string; group?: string }[],
): Map<string, string> => {
	const taken = new Set<string>();
	if (frames.some(({ group }) => group === undefined)) {
		taken.add(UNGROUPED_FOLDER);
	}
	const folderByGroup = new Map<string, string>();
	for (const { group } of frames) {
		if (group === undefined || folderByGroup.has(group)) {
			continue;
		}
		const base = groupFolderSlug(group);
		let folder = base;
		for (let suffix = 2; taken.has(folder); suffix += 1) {
			folder = `${base}-${suffix}`;
		}
		taken.add(folder);
		folderByGroup.set(group, folder);
	}
	return new Map(
		frames.map(({ id, group }) => [
			id,
			group === undefined ? UNGROUPED_FOLDER : (folderByGroup.get(group) ?? UNGROUPED_FOLDER),
		]),
	);
};

export const STUB_TOKENS_JSON = `${JSON.stringify({ version: 1, tokens: {} }, null, 2)}\n`;

export type CanvasImplementFrame = {
	id: string;
	label: string;
	width: number;
	group?: string;
	folder: string;
	artboardHash: string;
};

const NO_GROUP_HEADING = '(no group)';

export const buildCanvasImplementMarkdown = ({
	exportId,
	exportedAt,
	frames,
}: {
	exportId: string;
	exportedAt: string;
	frames: readonly CanvasImplementFrame[];
}): string => {
	// Sections keep first-appearance order; the no-group section counts like any group.
	const sections = new Map<string | undefined, CanvasImplementFrame[]>();
	for (const frame of frames) {
		const section = sections.get(frame.group);
		if (section === undefined) {
			sections.set(frame.group, [frame]);
		} else {
			section.push(frame);
		}
	}
	const frameFile = ({ folder, id }: CanvasImplementFrame): string =>
		`${folder}/${id}/${HANDOFF_INDEX_FILE}`;
	const sectionBlocks = [...sections.entries()].map(([group, sectionFrames]) => {
		const heading = group === undefined ? NO_GROUP_HEADING : collapseMarkdownHeaderValue(group);
		const lines = sectionFrames.map(
			(frame) =>
				`- ${collapseMarkdownHeaderValue(frame.label)} - id \`${frame.id}\`, width ${frame.width}, hash \`${frame.artboardHash}\`, file \`${frameFile(frame)}\``,
		);
		return `### ${heading} (\`${sectionFrames[0]?.folder ?? UNGROUPED_FOLDER}/\`)\n\n${lines.join('\n')}`;
	});
	const fileLines = frames.map(
		(frame) => `- ${frameFile(frame)} - one complete document per frame`,
	);
	return `# Implement this canvas

exportId: ${exportId}
exportedAt: ${exportedAt}
frames: ${frames.length}

## Frames

${sectionBlocks.join('\n\n')}

## Files

- ${CANVAS_PREVIEW_FILE} - view-only preview of the canvas layout; open it in a browser. It embeds preview copies with a measuring script; never implement from it
- ${TOKENS_FILE}
${fileLines.join('\n')}

## Instructions

1. Call \`handoff_status\` first. If \`stale\` is true, call \`export_artboard\` again (it exports the whole canvas) before implementing.
2. If MCP is unavailable, compare each frame's \`hash\` above with \`${CURSOR_DESIGN_DIR}/${ARTBOARDS_DIR}/<id>.meta.json\` \`hash\`, and the frame list with \`${CURSOR_DESIGN_DIR}/${ARTBOARDS_DIR}/*.html\`. On any difference, re-export, or ask the user to run **Export Handoff**.
3. Implement each frame from its own \`${HANDOFF_INDEX_FILE}\` (HTML+CSS+JS inline), not from screenshots or \`${CANVAS_PREVIEW_FILE}\`.
4. Each frame is a complete design at its \`width\`. In the implemented app, frames that show the same page at different widths (for example desktop and mobile, usually in the same \`group\`) are variants: build one responsive page that matches each frame at its width, combining their styles with media queries instead of pasting each frame's CSS and JS side by side, and keep each frame's classes and JS behavior. If it is unclear which frames are variants of one page, ask the user. Frames with no narrow variant should adapt to small screens in the implemented app. Never hard-code a frame's width on \`body\`.
5. Target the user's app entry files. Never copy \`${CURSOR_DESIGN_DIR}/\` into the app.
6. Keep semantic structure, classes, and behavior.
7. Assets referenced as \`assets/...\` resolve against \`${CURSOR_DESIGN_DIR}/assets/\`. Copy them manually.
`;
};

export type HandoffCompare = { exported: boolean; stale: boolean };

// Pairs current frames with the recorded export by id (order ignored). Layout never counts:
// stale only when the id set differs, a frame is unreadable, or an HTML hash changed.
export const compareCanvasHandoff = ({
	lastExport,
	frames,
}: {
	lastExport: LastExport | undefined;
	frames: readonly { artboardId: string; hash: string | undefined }[];
}): HandoffCompare => {
	if (lastExport === undefined) {
		return { exported: false, stale: false };
	}
	const recorded = lastExport.frames ?? [
		{ artboardId: lastExport.artboardId, artboardHash: lastExport.artboardHash },
	];
	const recordedHashById = new Map(
		recorded.map(({ artboardId, artboardHash }) => [artboardId, normalizeHash(artboardHash)]),
	);
	const stale =
		frames.length !== recordedHashById.size ||
		frames.some(({ artboardId, hash }) => {
			const recordedHash = recordedHashById.get(artboardId);
			return (
				recordedHash === undefined || hash === undefined || normalizeHash(hash) !== recordedHash
			);
		});
	return { exported: true, stale };
};
