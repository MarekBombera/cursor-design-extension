import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { VIBEBOARD_MCP_SERVER_NAME, VIBEBOARD_WORKSPACE_ROOT_ENV } from './mcpIdentity';

type Provider = {
	onDidChangeMcpServerDefinitions: (listener: () => void) => void;
	provideMcpServerDefinitions: () => {
		args: string[];
		env: Record<string, string>;
		version: string;
	}[];
};

const vscodeMock = vi.hoisted(() => ({
	cursor: undefined as
		| { mcp: { registerServer: (config: unknown) => void; unregisterServer: () => void } }
		| undefined,
	// The VS Code MCP API, served as the module's `lm` export (lint bans writing `.lm`).
	languageModelApi: undefined as
		| { registerMcpServerDefinitionProvider: (id: string, provider: unknown) => unknown }
		| undefined,
	get lm() {
		return this.languageModelApi;
	},
	workspace: {
		isTrusted: true,
		workspaceFolders: [{ uri: { fsPath: '/work/one' } }] as { uri: { fsPath: string } }[],
	},
	window: { showErrorMessage: () => Promise.resolve(undefined) },
	Uri: {
		joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
			fsPath: [base.fsPath, ...segments].join('/'),
		}),
	},
	EventEmitter: class {
		listeners: (() => void)[] = [];
		event = (listener: () => void): void => {
			this.listeners.push(listener);
		};
		fire(): void {
			for (const listener of this.listeners) {
				listener();
			}
		}
		dispose(): void {}
	},
	McpStdioServerDefinition: class {
		constructor(
			readonly label: string,
			readonly command: string,
			readonly args: string[],
			readonly env: Record<string, string>,
			readonly version: string,
		) {}
	},
}));

vi.mock('vscode', () => vscodeMock);

const outputLines: string[] = [];
const subscriptions: { dispose: () => void }[] = [];
const context = {
	extensionUri: { fsPath: '/extension' },
	subscriptions,
} as unknown as vscode.ExtensionContext;
const outputChannel = {
	appendLine: (line: string) => outputLines.push(line),
} as unknown as vscode.OutputChannel;

// Fresh module state (the once-per-host provider) for every test.
const register = async (): Promise<boolean> => {
	const { registerVibeboardMcp } = await import('./registerVibeboardMcp');
	return registerVibeboardMcp({ context, outputChannel });
};

beforeEach(() => {
	vi.resetModules();
	outputLines.length = 0;
	subscriptions.length = 0;
	vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: '/work/one' } }];
});

test('Cursor API present: Cursor only, even when VS Code API exists; a re-sync and deactivate never unregister the shared server', async () => {
	const calls: string[] = [];
	const registerProvider = vi.fn();
	vscodeMock.cursor = {
		mcp: {
			registerServer: () => calls.push('register'),
			unregisterServer: () => calls.push('unregister'),
		},
	};
	vscodeMock.languageModelApi = { registerMcpServerDefinitionProvider: registerProvider };

	assert.equal(await register(), true);
	const { registerVibeboardMcp } = await import('./registerVibeboardMcp');
	assert.equal(registerVibeboardMcp({ context, outputChannel }), true);
	for (const subscription of subscriptions.splice(0)) {
		subscription.dispose();
	}
	assert.deepEqual(calls, ['register', 'register']);
	assert.equal(registerProvider.mock.calls.length, 0);
});

test('no Cursor API, VS Code API present: one provider whose definition follows a re-sync', async () => {
	const registerProvider = vi.fn(() => ({ dispose: () => {} }));
	vscodeMock.cursor = undefined;
	vscodeMock.languageModelApi = { registerMcpServerDefinitionProvider: registerProvider };

	assert.equal(await register(), true);
	const [[providerId, provider]] = registerProvider.mock.calls as unknown as [[string, Provider]];
	const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
		contributes: { mcpServerDefinitionProviders: { id: string }[] };
	};
	assert.equal(providerId, VIBEBOARD_MCP_SERVER_NAME);
	assert.deepEqual(
		packageJson.contributes.mcpServerDefinitionProviders.map((entry) => entry.id),
		[providerId],
	);
	const [definition] = provider.provideMcpServerDefinitions();
	assert.deepEqual(definition.args, ['/extension/dist/mcp.js']);
	assert.equal(definition.env[VIBEBOARD_WORKSPACE_ROOT_ENV], '/work/one');
	assert.ok(definition.version.length > 0);

	const changed = vi.fn();
	provider.onDidChangeMcpServerDefinitions(changed);
	vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: '/work/two' } }];
	const { registerVibeboardMcp } = await import('./registerVibeboardMcp');
	assert.equal(registerVibeboardMcp({ context, outputChannel }), true);
	assert.equal(registerProvider.mock.calls.length, 1, 'never registers a second provider');
	assert.equal(changed.mock.calls.length, 1);
	const [resynced] = provider.provideMcpServerDefinitions();
	assert.equal(resynced.env[VIBEBOARD_WORKSPACE_ROOT_ENV], '/work/two');
	assert.notEqual(resynced.version, definition.version, 'a new version makes VS Code restart it');
});

test('VS Code API: deactivate, then activate in the same host registers a fresh provider', async () => {
	const registerProvider = vi.fn(() => ({ dispose: () => {} }));
	vscodeMock.cursor = undefined;
	vscodeMock.languageModelApi = { registerMcpServerDefinitionProvider: registerProvider };

	assert.equal(await register(), true);
	for (const subscription of subscriptions.splice(0)) {
		subscription.dispose();
	}
	const { registerVibeboardMcp } = await import('./registerVibeboardMcp');
	assert.equal(registerVibeboardMcp({ context, outputChannel }), true);
	assert.equal(registerProvider.mock.calls.length, 2);
	assert.ok(subscriptions.length > 0, 'the new activation hooks its dispose again');
});

test('neither API: registers nothing and says to add the server by hand', async () => {
	vscodeMock.cursor = undefined;
	vscodeMock.languageModelApi = undefined;

	assert.equal(await register(), false);
	assert.ok(outputLines.some((line) => line.includes('add the Vibeboard MCP server')));
});

test('no folder open: registers nothing and leaves the shared Cursor server alone', async () => {
	const calls: string[] = [];
	vscodeMock.cursor = {
		mcp: {
			registerServer: () => calls.push('register'),
			unregisterServer: () => calls.push('unregister'),
		},
	};
	vscodeMock.workspace.workspaceFolders = [];

	// Cursor's shared server still serves this window, so the panel must not say MCP is unavailable.
	assert.equal(await register(), true);
	assert.deepEqual(calls, []);
	assert.ok(outputLines.some((line) => line.includes('No folder is open')));
});

test('no folder open in VS Code: no provider, and MCP is unavailable in this window', async () => {
	const registerProvider = vi.fn();
	vscodeMock.cursor = undefined;
	vscodeMock.languageModelApi = { registerMcpServerDefinitionProvider: registerProvider };
	vscodeMock.workspace.workspaceFolders = [];

	assert.equal(await register(), false);
	assert.equal(registerProvider.mock.calls.length, 0);
});
