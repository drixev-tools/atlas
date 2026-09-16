import * as assert from 'assert';
import { buildSinglePageImagePdf } from '../../core/pdfFromImage';

suite('buildSinglePageImagePdf', () => {
	test('produces a PDF header, a MediaBox matching width/height, and an embedded DCTDecode image', () => {
		const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
		const pdf = Buffer.from(buildSinglePageImagePdf(jpegBytes, 800, 600));
		const text = pdf.toString('latin1');

		assert.ok(text.startsWith('%PDF-1.4'));
		assert.ok(text.includes('/MediaBox [0 0 800 600]'));
		assert.ok(text.includes('/Filter /DCTDecode'));
		assert.ok(text.includes(`/Length ${jpegBytes.length}`));
		assert.ok(text.includes(jpegBytes.toString('latin1')));
		assert.ok(text.trimEnd().endsWith('%%EOF'));
	});

	test('startxref points at the byte offset where the xref table actually starts', () => {
		const pdf = Buffer.from(buildSinglePageImagePdf(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 10, 10));
		const text = pdf.toString('latin1');

		const startxrefMatch = text.match(/startxref\n(\d+)\n/);
		assert.ok(startxrefMatch, 'expected a startxref offset');
		const offset = Number(startxrefMatch![1]);
		assert.strictEqual(text.slice(offset, offset + 4), 'xref');
	});

	test('rounds fractional width/height and floors them at 1', () => {
		const pdf = Buffer.from(buildSinglePageImagePdf(Buffer.from([0xff, 0xd8]), 0.2, 100.6));
		const text = pdf.toString('latin1');
		assert.ok(text.includes('/MediaBox [0 0 1 101]'));
	});
});
