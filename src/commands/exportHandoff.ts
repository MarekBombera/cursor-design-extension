import * as vscode from 'vscode';

import {
	ArtboardNotFoundError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	InvalidArtboardIdError,
	UnsupportedSchemaVersionError,
} from '../disk/errors';
import {
	exportActiveArtboardHandoff,
	toSafeArtboardErrorMessage,
	UNTRUSTED_WORKSPACE_MESSAGE,
} from '../host/artboardDisk';
import { logDiskError } from '../host/hostFs';

const NO_FOLDER_MESSAGE = 'Open a workspace folder to export a handoff.';
const NO_ACTIVE_MESSAGE = 'No active artboard to export. Run Cursor Design: Open Artboard first.';
const GENERIC_FAILURE_MESSAGE = 'Could not export handoff. Check the Output panel: Cursor Design.';

export const exportHandoff = async (outputChannel: vscode.OutputChannel): Promise<void> => {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(NO_FOLDER_MESSAGE);
		return;
	}
	if (!vscode.workspace.isTrusted) {
		await vscode.window.showErrorMessage(UNTRUSTED_WORKSPACE_MESSAGE);
		return;
	}

	try {
		const { exportId } = await exportActiveArtboardHandoff({ workspaceFolder, outputChannel });
		await vscode.window.showInformationMessage(
			`Handoff exported to .cursor-design/handoff/${exportId}/.`,
		);
	} catch (error: unknown) {
		if (error instanceof ArtboardNotFoundError) {
			await vscode.window.showErrorMessage(NO_ACTIVE_MESSAGE);
			return;
		}
		if (
			error instanceof CorruptManifestError ||
			error instanceof CorruptMetaError ||
			error instanceof InvalidArtboardIdError ||
			error instanceof UnsupportedSchemaVersionError
		) {
			await vscode.window.showErrorMessage(toSafeArtboardErrorMessage(error));
			return;
		}
		if (!(error instanceof DiskError)) {
			logDiskError({ scope: 'exportHandoff', error, outputChannel });
		}
		await vscode.window.showErrorMessage(GENERIC_FAILURE_MESSAGE);
	}
};
