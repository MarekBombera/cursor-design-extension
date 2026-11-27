import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { claimedRequestId, parseChromeMessage } from './chromeMessages';
import { InvalidArgsError, NoWorkspaceError } from '../disk/errors';
import type { PanelPorts } from '../panel/openArtboardPanel';
import type { ChromeMessage } from '../webview/hostMessages';

// The shared request preamble; all I/O through ports. Neither export throws.

type Refuse = (message: string, error: unknown) => void;

// Undefined: no usable requestId, logged only (nothing to answer to). Call it before the caller's
// try, so refuse stays in scope for its catch.
export const panelRequest = ({
	value,
	type,
	scope,
	ports,
	afterRefuse,
}: {
	value: unknown;
	type: ChromeMessage['type'];
	scope: string;
	ports: PanelPorts;
	afterRefuse?: () => void;
}): { requestId: string; refuse: Refuse } | undefined => {
	const requestId = claimedRequestId(value);
	if (requestId === undefined) {
		ports.log(scope, new InvalidArgsError(`${type} from the panel has no valid requestId.`));
		return undefined;
	}
	return {
		requestId,
		refuse: (message, error) => {
			ports.log(scope, error);
			ports.postAnswer({ type: 'ui:error', requestId, message });
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
	ports,
}: {
	value: unknown;
	type: T;
	malformedMessage: string;
	refuse: Refuse;
	ports: PanelPorts;
}): { workspaceRoot: string; message: Extract<ChromeMessage, { type: T }> } | undefined => {
	if (!ports.isTrusted()) {
		refuse(UNTRUSTED_WORKSPACE_MESSAGE, `${type} refused in an untrusted workspace.`);
		return undefined;
	}
	const workspaceRoot = ports.workspaceRoot();
	if (workspaceRoot === undefined) {
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
	return { workspaceRoot, message };
};
