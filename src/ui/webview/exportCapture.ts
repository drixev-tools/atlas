// DOM-to-image capture behind every view's "Export" action: `html-to-image`
// serializes `element`'s current rendered state (pan/zoom, expansion,
// selection — whatever's actually on screen) straight to SVG/PNG/JPEG, so
// this stays a thin wrapper rather than a from-scratch diagram renderer.
// `pixelRatio: 1` keeps the output's pixel size equal to `element`'s own CSS
// size, matching the `width`/`height` this reports back (the extension host
// needs those for the PDF export's page size).
import { toJpeg, toPng, toSvg } from 'html-to-image';

export type CaptureFormat = 'svg' | 'png' | 'pdf';

export interface CapturedExport {
	payload: string;
	width: number;
	height: number;
}

const CAPTURE_OPTIONS = {
	pixelRatio: 1,
	filter: (node: HTMLElement) =>
		!(node.classList?.contains('react-flow__controls') || node.classList?.contains('react-flow__attribution') || node.getAttribute?.('data-export-ignore') === 'true')
};

function payloadFromDataUrl(dataUrl: string): string {
	const commaIndex = dataUrl.indexOf(',');
	const encoded = dataUrl.slice(commaIndex + 1);
	return dataUrl.slice(0, commaIndex).includes(';base64') ? encoded : decodeURIComponent(encoded);
}

/** `format`'s captured content of `element` (raw SVG markup for `svg`, base64 for `png`/`pdf` — `pdf` captures JPEG, for `writePdfExportFromJpeg`'s DCTDecode embedding), plus its captured pixel size. */
export async function captureViewExport(element: HTMLElement, format: CaptureFormat): Promise<CapturedExport> {
	const { width, height } = element.getBoundingClientRect();
	const dataUrl =
		format === 'svg' ? await toSvg(element, CAPTURE_OPTIONS) : format === 'png' ? await toPng(element, CAPTURE_OPTIONS) : await toJpeg(element, { ...CAPTURE_OPTIONS, quality: 0.95 });
	return { payload: payloadFromDataUrl(dataUrl), width: Math.round(width), height: Math.round(height) };
}
