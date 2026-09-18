// Shared "Export" plumbing for the three diagram webviews (./graphPanel,
// ./activeFileFlowPanel, ./sequenceDiagramView): a native VS Code save dialog
// picks both the destination and the format (via its file-type dropdown), so
// each panel only needs to turn its own data into a Markdown string (for the
// `markdown` format) or forward an `export:capture` request to the webview
// (for `svg`/`png`/`pdf`, which need the live rendered view).
import * as vscode from 'vscode';
import { buildSinglePageImagePdf } from '../core/pdfFromImage';

export type ExportFormat = 'markdown' | 'svg' | 'png' | 'pdf';

const FORMAT_BY_EXTENSION: Record<string, ExportFormat> = { md: 'markdown', svg: 'svg', png: 'png', pdf: 'pdf' };

export interface ExportDestination {
	uri: vscode.Uri;
	format: ExportFormat;
}

/** Shows VS Code's native save dialog with Markdown/SVG/PNG/PDF as its file-type choices, resolving the picked format from the extension it produces. `undefined` when the user cancels or (defensively) picks an unrecognized extension. */
export async function pickExportDestination(defaultFileName: string): Promise<ExportDestination | undefined> {
	const uri = await vscode.window.showSaveDialog({
		saveLabel: 'Export',
		defaultUri: vscode.Uri.file(defaultFileName),
		filters: { Markdown: ['md'], 'SVG Image': ['svg'], 'PNG Image': ['png'], 'PDF Document': ['pdf'] }
	});
	if (!uri) {
		return undefined;
	}

	const extension = uri.fsPath.split('.').pop()?.toLowerCase();
	const format = extension ? FORMAT_BY_EXTENSION[extension] : undefined;
	if (!format) {
		void vscode.window.showErrorMessage('Atlas: export the diagram as a .md, .svg, .png, or .pdf file.');
		return undefined;
	}
	return { uri, format };
}

export async function writeMarkdownExport(uri: vscode.Uri, markdown: string): Promise<void> {
	await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
	notifyExported(uri);
}

export async function writeSvgExport(uri: vscode.Uri, svgMarkup: string): Promise<void> {
	await vscode.workspace.fs.writeFile(uri, Buffer.from(svgMarkup, 'utf8'));
	notifyExported(uri);
}

export async function writePngExport(uri: vscode.Uri, pngBase64: string): Promise<void> {
	await vscode.workspace.fs.writeFile(uri, Buffer.from(pngBase64, 'base64'));
	notifyExported(uri);
}

/** Builds the PDF (`buildSinglePageImagePdf`) from the webview's JPEG capture and writes it — "PDF from the exported image", not a separate PDF renderer. */
export async function writePdfExportFromJpeg(uri: vscode.Uri, jpegBase64: string, width: number, height: number): Promise<void> {
	const pdfBytes = buildSinglePageImagePdf(Buffer.from(jpegBase64, 'base64'), width, height);
	await vscode.workspace.fs.writeFile(uri, pdfBytes);
	notifyExported(uri);
}

function notifyExported(uri: vscode.Uri): void {
	void vscode.window.showInformationMessage(`Atlas: exported to ${uri.fsPath}`);
}
