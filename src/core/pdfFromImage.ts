// Wraps an already-exported JPEG (the webview's own current-view capture,
// see ../ui/webview/exportCapture) into a minimal single-page PDF, without
// pulling in a general-purpose PDF renderer: PDF's `DCTDecode` filter accepts
// a baseline JPEG's compressed bytes as-is (no re-encoding), so the whole
// file is just that image plus a handful of small text objects around it.
function xrefEntry(offset: number, generation: number, inUse: boolean): string {
	// Each entry must be exactly 20 bytes per the PDF spec's fixed-width xref
	// table format; readers that check this strictly (unlike most browsers)
	// reject a table that doesn't line up.
	return `${offset.toString().padStart(10, '0')} ${generation.toString().padStart(5, '0')} ${inUse ? 'n' : 'f'} \n`;
}

/** A one-page PDF whose page is exactly `width`x`height` points (1:1 with `jpegBytes`' pixel dimensions) showing `jpegBytes` as its only content, embedded via `DCTDecode` passthrough. Assumes a baseline RGB JPEG, matching what a `<canvas>.toDataURL('image/jpeg')` capture always produces. */
export function buildSinglePageImagePdf(jpegBytes: Uint8Array, width: number, height: number): Uint8Array {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));

	const chunks: Buffer[] = [];
	const offsetByObject: number[] = [];
	let length = 0;

	const push = (buffer: Buffer): void => {
		chunks.push(buffer);
		length += buffer.length;
	};

	const pushObject = (index: number, text: string): void => {
		offsetByObject[index] = length;
		push(Buffer.from(text, 'ascii'));
	};

	push(Buffer.from('%PDF-1.4\n', 'ascii'));

	pushObject(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
	pushObject(2, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
	pushObject(
		3,
		`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
	);

	const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ`;
	pushObject(4, `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream\nendobj\n`);

	offsetByObject[5] = length;
	push(
		Buffer.from(
			`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
			'ascii'
		)
	);
	push(Buffer.from(jpegBytes));
	push(Buffer.from('\nendstream\nendobj\n', 'ascii'));

	const xrefOffset = length;
	push(Buffer.from(`xref\n0 6\n${xrefEntry(0, 65535, false)}`, 'ascii'));
	for (let index = 1; index <= 5; index++) {
		push(Buffer.from(xrefEntry(offsetByObject[index], 0, true), 'ascii'));
	}
	push(Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, 'ascii'));

	return Buffer.concat(chunks);
}
