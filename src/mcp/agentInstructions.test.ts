import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, vi } from 'vite-plus/test';

import { readAgentInstructions } from './agentInstructions';

test('a CRLF skill loses its frontmatter and managed-file note; a missing one yields none', async () => {
	const root = await mkdtemp(join(tmpdir(), 'vibeboard-instructions-'));
	try {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		assert.equal(readAgentInstructions(root), undefined);

		await mkdir(join(root, 'skills', 'vibeboard'), { recursive: true });
		await writeFile(
			join(root, 'skills', 'vibeboard', 'SKILL.md'),
			'---\r\nname: vibeboard\r\n---\r\n\r\n> Managed note.\r\n\r\n# vibeboard\r\n\r\nBody.\r\n',
		);
		assert.equal(readAgentInstructions(root), '# vibeboard\r\n\r\nBody.');
	} finally {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
});
