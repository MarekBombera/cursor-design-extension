import { type McpServer } from '@modelcontextprotocol/server';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InvalidRootError, NoWorkspaceError, logStderr } from '../disk/errors';
import { VIBEBOARD_WORKSPACE_ROOT_ENV, VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';

let rootsInvalidLogged = false;

const parseRootsJson = (raw: string): string[] | undefined => {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			!Array.isArray(parsed) ||
			!parsed.every((item: unknown): item is string => typeof item === 'string' && item.length > 0)
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

/** @internal */
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

// Long enough for a busy editor, short enough that a client that never answers costs one wait.
const CLIENT_ROOTS_TIMEOUT_MS = 5000;

// Per connection (one McpServer per connection). undefined = the client has no roots capability,
// so the env roots apply. A rejection is never kept: the next call asks the client again.
const clientRootsByServer = new WeakMap<McpServer, Promise<string[] | undefined>>();

const logRootsSource = (source: string): void => {
	process.stderr.write(`vibeboard MCP: workspace roots ${source}\n`);
};

// The SDK already rejects a whole roots/list result that holds a non-file:// URI.
const fileRootPaths = (uris: readonly string[]): string[] =>
	uris.flatMap((uri) => {
		try {
			return [fileURLToPath(uri)];
		} catch (error) {
			logStderr('roots/list file URI', error);
			return [];
		}
	});

// A client that declares roots is the authority on its folders: no folders, or no answer, is
// NO_WORKSPACE, never the env roots (with Cursor's shared server those are another window's).
const fetchClientRoots = async (server: McpServer): Promise<string[] | undefined> => {
	if (server.server.getClientCapabilities()?.roots === undefined) {
		logRootsSource('from env fallback (client has no roots capability)');
		return undefined;
	}
	let roots: readonly { uri: string }[];
	try {
		// listRoots is deprecated for the 2026-07-28 protocol era (no server-to-client requests);
		// on such a connection it throws, so every call answers NO_WORKSPACE. Today's stdio
		// handshake is 2025-era.
		({ roots } = await server.server.listRoots(undefined, { timeout: CLIENT_ROOTS_TIMEOUT_MS }));
	} catch (error) {
		logStderr('roots/list', error);
		throw new NoWorkspaceError({ cause: error });
	}
	const paths = fileRootPaths(roots.map(({ uri }) => uri));
	if (paths.length === 0) {
		logRootsSource('from client: none (NO_WORKSPACE)');
		throw new NoWorkspaceError();
	}
	logRootsSource(`from client: ${JSON.stringify(paths)}`);
	return paths;
};

/** The folders a tool may act on: the client's MCP roots when it declares roots, else the env roots. */
export const allowedWorkspaceRoots = async (server: McpServer): Promise<string[]> => {
	let clientRoots = clientRootsByServer.get(server);
	if (clientRoots === undefined) {
		server.server.setNotificationHandler('notifications/roots/list_changed', () => {
			clientRootsByServer.delete(server);
		});
		const fetched = fetchClientRoots(server);
		clientRootsByServer.set(server, fetched);
		fetched.catch(() => {
			if (clientRootsByServer.get(server) === fetched) {
				clientRootsByServer.delete(server);
			}
		});
		clientRoots = fetched;
	}
	return (await clientRoots) ?? parseWorkspaceRootsEnv(process.env);
};
