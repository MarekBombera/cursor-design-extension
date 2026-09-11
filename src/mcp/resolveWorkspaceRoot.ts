import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AmbiguousWorkspaceError, InvalidRootError, NoWorkspaceError } from '../disk/errors';
import { CURSOR_DESIGN_DIR } from '../disk/layout';
import { CURSOR_DESIGN_WORKSPACE_ROOT_ENV, CURSOR_DESIGN_WORKSPACE_ROOTS_ENV } from './mcpIdentity';

const parseRootsJson = (raw: string): string[] | undefined => {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		if (!parsed.every((item) => typeof item === 'string' && item.length > 0)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
};

export const parseWorkspaceRootsEnv = (env: NodeJS.Dict<string>): string[] => {
	const rootsRaw = env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	if (rootsRaw !== undefined) {
		const parsed = parseRootsJson(rootsRaw);
		if (parsed !== undefined) {
			if (parsed.length === 0) {
				throw new NoWorkspaceError();
			}
			return parsed;
		}
	}
	const root = env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	if (typeof root === 'string' && root.length > 0) {
		return [root];
	}
	throw new NoWorkspaceError();
};

export const resolveWorkspaceRoot = ({
	roots,
	rootPath,
}: {
	roots: string[];
	rootPath?: string;
}): string => {
	if (rootPath !== undefined) {
		if (!roots.includes(rootPath)) {
			throw new InvalidRootError();
		}
		return rootPath;
	}
	const withLayout = roots.filter((folder) => existsSync(join(folder, CURSOR_DESIGN_DIR)));
	if (withLayout.length === 1) {
		return withLayout[0];
	}
	if (roots.length === 1) {
		return roots[0];
	}
	throw new AmbiguousWorkspaceError();
};
