import { isAbsolute, resolve } from 'node:path';

import { InvalidRootError, NoWorkspaceError, logStderr } from '../disk/errors';
import { VIBEBOARD_WORKSPACE_ROOT_ENV, VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';

let rootsInvalidLogged = false;

const parseRootsJson = (raw: string): string[] | undefined => {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			!Array.isArray(parsed) ||
			!parsed.every((item) => typeof item === 'string' && item.length > 0)
		) {
			throw new Error('expected a JSON array of non-empty strings');
		}
		return parsed;
	} catch (error) {
		// ponytail: falls back to the ROOT env, so only the ROOT folder (the first) is served, and
		// later invalid values in the same process are not logged. Upgrade path: fail the tool call
		// with an authored error instead of falling back.
		if (!rootsInvalidLogged) {
			rootsInvalidLogged = true;
			logStderr(`${VIBEBOARD_WORKSPACE_ROOTS_ENV} parse`, error);
		}
		return undefined;
	}
};

export const parseWorkspaceRootsEnv = (env: NodeJS.Dict<string>): string[] => {
	const rootsRaw = env[VIBEBOARD_WORKSPACE_ROOTS_ENV];
	if (rootsRaw !== undefined) {
		const parsed = parseRootsJson(rootsRaw);
		if (parsed !== undefined) {
			if (parsed.length === 0) {
				throw new NoWorkspaceError();
			}
			return parsed;
		}
	}
	const root = env[VIBEBOARD_WORKSPACE_ROOT_ENV];
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
