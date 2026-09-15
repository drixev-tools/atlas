// Thin wrapper around the `acquireVsCodeApi()` global VS Code injects into
// every webview, typed against this view's own `WebviewToHostMessage` half
// of the shared contract (./protocol) so the rest of the webview never talks
// to the raw API directly.
import { WebviewToHostMessage } from './protocol';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();

export function postToHost(message: WebviewToHostMessage): void {
	vscodeApi.postMessage(message);
}
