// The `postMessage` contract between the extension host
// (../identifiedArchitecturePanel.ts) and this webview
// (./IdentifiedArchitectureApp.tsx) — the same webview bundle as ./App.tsx's,
// rendering a different root component (see ./main.tsx), so this stays its
// own small contract rather than growing ./protocol.ts's.
import { DiagramModel } from '../../core/diagramModel';

export interface IdentifiedArchitecturePayload {
	model: DiagramModel;
	patternName: string;
	patternDescription: string;
	roleDescriptionsByGroupId: Record<string, string>;
}

export type IdentifiedArchitectureExportFormat = 'svg' | 'png' | 'pdf';

export type IdentifiedArchitectureHostToWebviewMessage =
	| { type: 'identifiedArchitecture:update'; payload: IdentifiedArchitecturePayload }
	| { type: 'identifiedArchitecture:needsApiKey' }
	| { type: 'identifiedArchitecture:loading' }
	| { type: 'identifiedArchitecture:empty' }
	| { type: 'identifiedArchitecture:exportCapture'; format: IdentifiedArchitectureExportFormat };

export type IdentifiedArchitectureWebviewToHostMessage =
	| { type: 'identifiedArchitecture:ready' }
	| { type: 'identifiedArchitecture:openAiSettings' }
	| { type: 'identifiedArchitecture:exportRequest' }
	| { type: 'identifiedArchitecture:exportCaptured'; format: IdentifiedArchitectureExportFormat; payload: string; width: number; height: number }
	| { type: 'identifiedArchitecture:exportCaptureFailed' };
