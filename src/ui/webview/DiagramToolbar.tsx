import type { ReactElement } from 'react';

export interface DiagramToolbarProps {
	onExport: () => void;
	exportDisabled?: boolean;
	onResetLayout: () => void;
	resetLayoutDisabled?: boolean;
}

/** The floating toolbar a draggable diagram view offers: "Reset Layout" (undo manual dragging back to the auto-computed layout, see ./useDraggableLayout) alongside the "Export" every diagram view has (./ExportButton). `data-export-ignore` keeps both buttons out of ./exportCapture's screenshot. */
export function DiagramToolbar({ onExport, exportDisabled, onResetLayout, resetLayoutDisabled }: DiagramToolbarProps): ReactElement {
	return (
		<div className="ag-export-toolbar" data-export-ignore="true">
			<button type="button" onClick={onResetLayout} disabled={resetLayoutDisabled}>
				Reset Layout
			</button>
			<button type="button" onClick={onExport} disabled={exportDisabled}>
				{exportDisabled ? 'Exporting…' : 'Export'}
			</button>
		</div>
	);
}
