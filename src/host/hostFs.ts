import * as vscode from 'vscode';

import { CHROME_CSS_SEGMENTS, CHROME_JS_SEGMENTS } from '../panel/artboardChromeHtml';

// ponytail: first folder only. Upgrade path: pick the folder holding .cursor-design/, else ask.
export const firstWorkspaceFolder = (): vscode.WorkspaceFolder | undefined =>
	vscode.workspace.workspaceFolders?.[0];

export const NO_FOLDER_MESSAGE =
	'Open a workspace folder first. Cursor Design does not store artboards without a folder.';

export const isFileNotFound = (error: unknown): boolean =>
	error instanceof vscode.FileSystemError &&
	(error.code === 'FileNotFound' || error.code === 'EntryNotFound');

export const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return false;
		}
		throw error;
	}
};

// ponytail: a non-not-found stat error counts as missing and is not logged: no Output channel is
// in reach where the panel is created. Upgrade path: pass the channel and use logDiskError.
// Known gap: a chrome.js that loads but throws before mounting still shows a blank panel.
// Upgrade path: shell fallback text revealed after a delay.
export const missingChromeAssets = async (extensionUri: vscode.Uri): Promise<string[]> => {
	const assets = [CHROME_JS_SEGMENTS, CHROME_CSS_SEGMENTS];
	const present = await Promise.all(
		assets.map((segments) =>
			fileExists(vscode.Uri.joinPath(extensionUri, ...segments)).catch(() => false),
		),
	);
	return assets.filter((_, index) => !present[index]).map((segments) => segments.join('/'));
};

export const chromeLoadErrorMessage = (missing: readonly string[]): string =>
	`Cursor Design could not load its panel: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Reinstall the extension, or run pnpm compile in a development checkout.`;

type LogDiskErrorArgs = {
	scope: string;
	error: unknown;
	outputChannel: vscode.OutputChannel;
};

export const logDiskError = ({ scope, error, outputChannel }: LogDiskErrorArgs): void => {
	outputChannel.appendLine(
		`${scope}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
	);
};
