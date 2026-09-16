// Thin wrapper around the `acquireVsCodeApi()` global VS Code injects into
// every webview, typed against every root component's own
// `WebviewToHostMessage` half of its host contract (./protocol,
// ./entryPointFlowProtocol, ./sequenceDiagramProtocol) so the rest of the
// webview never talks to the raw API directly. `acquireVsCodeApi()` can only
// be called once per webview context, so this stays a single module-level
// instance shared by whichever root component ./main.tsx actually renders.
import { WebviewToHostMessage } from './protocol';
import { EntryPointFlowWebviewToHostMessage } from './entryPointFlowProtocol';
import { SequenceDiagramWebviewToHostMessage } from './sequenceDiagramProtocol';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();

export function postToHost(message: WebviewToHostMessage | EntryPointFlowWebviewToHostMessage | SequenceDiagramWebviewToHostMessage): void {
	vscodeApi.postMessage(message);
}
