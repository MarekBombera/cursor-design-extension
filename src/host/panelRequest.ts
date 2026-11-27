import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { claimedRequestId, parseChromeMessage } from './chromeMessages';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import { InvalidArgsError, NoWorkspaceError } from '../disk/errors';
import { postAnswerToPanel } from '../panel/openArtboardPanel';
import type { ChromeMessage } from '../webview/hostMessages';

// vscode glue only. Neither export throws.

type Refuse = (message: string, error: unknown) => void;

// Undefined: no usable requestId, logged only (nothing to answer to). Call it before the caller's
// try, so refuse stays in scope for its catch.
export const panelRequest = ({
	value,
	type,
	scope,
	outputChannel,
	afterRefuse,
}: {
	value: unknown;
	type: string;
	scope: string;
	outputChannel: vscode.OutputChannel;
	afterRefuse?: () => void;
}): { requestId: string; refuse: Refuse } | undefined => {
	const requestId = claimedRequestId(value);
	if (requestId === undefined) {
		logDiskError({
			scope,
			error: new InvalidArgsError(`${type} from the panel has no valid requestId.`),
			outputChannel,
		});
		return undefined;
	}
	return {
		requestId,
		refuse: (message, error) => {
			logDiskError({ scope, error, outputChannel });
			postAnswerToPanel({ type: 'ui:error', requestId, message });
			afterRefuse?.();
		},
	};
};

// Trust, folder, then parse. Undefined: already refused.
export const checkedPanelMessage = <T extends ChromeMessage['type']>({
	value,
	type,
	malformedMessage,
	refuse,
}: {
	value: unknown;
	type: T;
	malformedMessage: string;
	refuse: Refuse;
}): { workspaceRoot: string; message: Extract<ChromeMessage, { type: T }> } | undefined => {
	if (!vscode.workspace.isTrusted) {
		refuse(UNTRUSTED_WORKSPACE_MESSAGE, `${type} refused in an untrusted workspace.`);
		return undefined;
	}
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		const error = new NoWorkspaceError();
		refuse(error.message, error);
		return undefined;
	}
	const message = parseChromeMessage(value);
	const isRequested = (
		parsed: ChromeMessage | undefined,
	): parsed is Extract<ChromeMessage, { type: T }> => parsed?.type === type;
	if (!isRequested(message)) {
		refuse(malformedMessage, new InvalidArgsError(`Malformed ${type} message from the panel.`));
		return undefined;
	}
	return { workspaceRoot: workspaceFolder.uri.fsPath, message };
};
