import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logStderr } from '../disk/errors';

// The shipped Agent skill without its frontmatter and the leading blockquote (the note about the
// ~/.cursor/skills/ copy), sent as MCP `instructions` so every agent gets it, not only Cursor.
// Undefined when the file is missing: the tools still work, only the workflow guide is lost.
export const readAgentInstructions = (extensionRoot: string): string | undefined => {
	try {
		const skill = readFileSync(join(extensionRoot, 'skills', 'vibeboard', 'SKILL.md'), 'utf8');
		return (
			skill
				.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
				.replace(/^\s*(?:>.*\r?\n)+/, '')
				.trim() || undefined
		);
	} catch (error: unknown) {
		logStderr('readAgentInstructions', error);
		return undefined;
	}
};
