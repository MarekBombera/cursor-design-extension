import { homedir } from 'node:os';
import * as vscode from 'vscode';

import { isFileNotFound, logDiskError } from './hostFs';

const SKILL_PATH_SEGMENTS = ['skills', 'cursor-design', 'SKILL.md'] as const;

type SyncAgentSkillArgs = {
	extensionUri: vscode.Uri;
	outputChannel: vscode.OutputChannel;
};

const readIfExists = async (uri: vscode.Uri): Promise<Uint8Array | undefined> => {
	try {
		return await vscode.workspace.fs.readFile(uri);
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return undefined;
		}
		throw error;
	}
};

// True when the path is a symlink (stat sets the SymbolicLink bit on links), false when absent.
const isSymlink = async (uri: vscode.Uri): Promise<boolean> => {
	try {
		return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.SymbolicLink) !== 0;
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return false;
		}
		throw error;
	}
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
	left.length === right.length && left.every((byte, index) => byte === right[index]);

// Copies the shipped Agent skill to ~/.cursor/skills/cursor-design/ (Cursor loads user-level
// skills there) whenever the installed copy is missing or differs, so it always matches this
// extension version. ponytail: writes to the extension host's home; in a remote window that is
// the remote home, which Cursor may not read. Upgrade path: a `ui` helper or a workspace install.
export const syncAgentSkill = async ({
	extensionUri,
	outputChannel,
}: SyncAgentSkillArgs): Promise<void> => {
	try {
		const bundled = await vscode.workspace.fs.readFile(
			vscode.Uri.joinPath(extensionUri, ...SKILL_PATH_SEGMENTS),
		);
		const installedUri = vscode.Uri.joinPath(
			vscode.Uri.file(homedir()),
			'.cursor',
			...SKILL_PATH_SEGMENTS,
		);
		const installedDir = vscode.Uri.joinPath(installedUri, '..');
		// A user who linked the skill folder or file to their own checkout keeps it: never write
		// through a link into a file the extension does not own.
		if ((await isSymlink(installedDir)) || (await isSymlink(installedUri))) {
			outputChannel.appendLine(
				'agentSkill.sync: ~/.cursor/skills/cursor-design is a symlink; leaving it unchanged.',
			);
			return;
		}
		const installed = await readIfExists(installedUri);
		if (installed !== undefined && sameBytes(installed, bundled)) {
			return;
		}
		await vscode.workspace.fs.createDirectory(installedDir);
		await vscode.workspace.fs.writeFile(installedUri, bundled);
	} catch (error: unknown) {
		logDiskError({ scope: 'agentSkill.sync', error, outputChannel });
	}
};
