import { isAbsolute, resolve } from 'node:path';

import { InvalidRootError, NoWorkspaceError } from '../disk/errors';
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
		// ponytail: invalid ROOTS JSON falls back to ROOT env; malformed is not a crash
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
		// Relative paths would resolve against the MCP process cwd, not a workspace folder.
		const matchedRoot = isAbsolute(rootPath)
			? roots.find((root) => resolve(root) === resolve(rootPath))
			: undefined;
		if (matchedRoot === undefined) {
			throw new InvalidRootError(roots);
		}
		return matchedRoot;
	}
	const firstRoot = roots[0];
	if (firstRoot === undefined) {
		throw new NoWorkspaceError();
	}
	return firstRoot;
};
