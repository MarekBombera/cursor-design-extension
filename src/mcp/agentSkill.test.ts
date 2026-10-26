import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import {
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	MAX_FRAME_HEIGHT,
	MAX_FRAME_WIDTH,
	MIN_FRAME_WIDTH,
} from '../disk/layout';
import { artboardToolInputSchemas } from './artboardTools';
import { commentToolInputSchemas } from './commentTools';

// Drift guard for the shipped Agent skill (skills/cursor-design/SKILL.md): a tool, Agent-visible
// error code, frame limit or sandbox change that lands without the skill fails here. Rule 02 and
// AGENTS.md cover the prose a test cannot see.

const readRepoFile = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const skill = readRepoFile('skills/cursor-design/SKILL.md');

const DOCUMENTED_TOOLS = new Set([
	...Object.keys(artboardToolInputSchemas),
	...Object.keys(commentToolInputSchemas),
]);

const ERROR_CODES = new Set(
	[...readRepoFile('src/disk/errors.ts').matchAll(/readonly code = '([A-Za-z_]+)'/g)].map(
		(match) => match[1],
	),
);

// Raised only by the panel (host), never returned to the Agent by an MCP tool.
const HOST_ONLY_CODES = new Set(['FRAME_MOVED', 'PICK_OUTDATED']);

test('frontmatter names the skill and says when to use it', () => {
	const frontmatter = /^---\nname: cursor-design\ndescription: (.+)\n---\n/.exec(skill);
	assert.ok(frontmatter, 'frontmatter must start the file with name: cursor-design');
	assert.ok(frontmatter[1].trim().length > 0);
});

test('every registered MCP tool is documented in the skill', () => {
	for (const name of DOCUMENTED_TOOLS) {
		// `name` alone or as a call shape `name({ ... })`.
		assert.ok(
			skill.includes(`\`${name}\``) || skill.includes(`\`${name}(`),
			`skill does not mention \`${name}\``,
		);
	}
});

test('every snake_case name anywhere in the skill is a real tool', () => {
	for (const word of skill.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
		assert.ok(DOCUMENTED_TOOLS.has(word), `skill mentions unknown tool \`${word}\``);
	}
});

test('every Agent-visible error code is documented in the skill', () => {
	assert.ok(ERROR_CODES.size > 0);
	for (const code of ERROR_CODES) {
		if (!HOST_ONLY_CODES.has(code)) {
			assert.ok(skill.includes(`\`${code}\``), `skill does not mention \`${code}\``);
		}
	}
});

test('every error code in the skill exists', () => {
	for (const [, word] of skill.matchAll(/`([A-Z]+(?:_[A-Z]+)+)`/g)) {
		assert.ok(ERROR_CODES.has(word), `skill mentions unknown error code \`${word}\``);
	}
});

test('the skill states the current frame limits', () => {
	assert.ok(skill.includes(`${MIN_FRAME_WIDTH}–${MAX_FRAME_WIDTH}`));
	assert.ok(skill.includes(`default ${DEFAULT_FRAME_WIDTH}`));
	assert.ok(skill.includes(`${FRAME_GAP} px gap`));
	assert.ok(skill.includes(`up to ${MAX_FRAME_HEIGHT} px`));
});

test('the skill states the frame sandbox the panel uses', () => {
	const sandbox = /sandbox="[^"]*"/.exec(readRepoFile('src/webview/Frame.svelte'))?.[0];
	assert.ok(sandbox);
	assert.ok(skill.includes(sandbox), `skill must state ${sandbox}`);
});
