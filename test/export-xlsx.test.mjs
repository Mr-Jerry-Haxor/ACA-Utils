import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExcelFilename, createXlsxBlob } from '../src/js/export.js';

test('Excel export creates an XLSX package with worksheet, filters, and frozen header', async () => {
  const blob = createXlsxBlob(
    [{ application: 'Example & Test', count: 12 }],
    [{ key: 'application', label: 'Application' }, { key: 'count', label: 'Count' }],
    new Date('2026-10-30T00:00:00Z'),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(text, /xl\/worksheets\/sheet1\.xml/);
  assert.match(text, /state="frozen"/);
  assert.match(text, /<autoFilter ref="A1:B2"\/>/);
  assert.match(text, /Example &amp; Test/);
});

test('Excel filenames contain the IST export date and time', () => {
  assert.equal(
    buildExcelFilename('All Non-Compliant Records', new Date('2026-10-30T00:00:00Z')),
    'All-Non-Compliant-Records-2026-10-30_05-30-00_IST.xlsx',
  );
});
