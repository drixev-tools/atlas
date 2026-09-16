import type { ReactElement } from 'react';

export interface ExportButtonProps {
	onClick: () => void;
	disabled?: boolean;
}

/** The floating "Export" action every diagram view offers. `data-export-ignore` keeps the button itself out of `./exportCapture`'s screenshot of the view it triggers. */
export function ExportButton({ onClick, disabled }: ExportButtonProps): ReactElement {
	return (
		<div className="ag-export-toolbar" data-export-ignore="true">
			<button type="button" onClick={onClick} disabled={disabled}>
				{disabled ? 'Exporting…' : 'Export'}
			</button>
		</div>
	);
}
