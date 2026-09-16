// The `postMessage` contract between the extension host (../sequenceDiagramView.ts)
// and this webview (./SequenceDiagramApp.tsx) — the same webview bundle as
// ./App.tsx's and ./EntryPointFlowApp.tsx's, rendering a different root
// component (see ./main.tsx), so this stays its own small contract rather
// than growing either of theirs. `SequenceDiagramViewState` is already plain
// JSON (no Map/Set fields), so it doubles as the payload without a separate
// serialized shape, unlike ./entryPointFlowProtocol's `EntryPointFlowPayload`.
import { SequenceDiagramViewState } from '../sequenceDiagram';

export type SequenceDiagramHostToWebviewMessage = { type: 'sequenceDiagram:state' } & SequenceDiagramViewState;

export type SequenceDiagramWebviewToHostMessage =
	| { type: 'sequenceDiagram:ready' }
	| { type: 'sequenceDiagram:openLifeline'; lifelineId: string }
	| { type: 'sequenceDiagram:openAiSettings' };
