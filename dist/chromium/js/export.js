const encoder = new TextEncoder();
const CRC_TABLE = buildCrcTable();

export function exportExcel(rows, columns, filename, exportedAt = new Date()) {
  download(createXlsxBlob(rows, columns, exportedAt), buildExcelFilename(filename, exportedAt));
}

export function createXlsxBlob(rows, columns, exportedAt = new Date()) {
  const lastColumn = columnName(Math.max(1, columns.length));
  const lastRow = Math.max(1, rows.length + 1);
  const sheetRows = [
    worksheetRow(1, columns.map((column) => column.label), true),
    ...rows.map((row, index) => worksheetRow(index + 2, columns.map((column) => rawValue(row, column)), false)),
  ].join('');
  const widths = columns.map((column) => {
    const values = rows.slice(0, 500).map((row) => String(rawValue(row, column) ?? '').length);
    return Math.min(50, Math.max(10, column.label.length + 2, ...values) + 1);
  });
  const timestamp = exportedAt.toISOString();
  const entries = [
    ['[Content_Types].xml', contentTypesXml()],
    ['_rels/.rels', rootRelationshipsXml()],
    ['docProps/app.xml', appPropertiesXml()],
    ['docProps/core.xml', corePropertiesXml(timestamp)],
    ['xl/workbook.xml', workbookXml()],
    ['xl/_rels/workbook.xml.rels', workbookRelationshipsXml()],
    ['xl/styles.xml', stylesXml()],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`],
  ];
  return new Blob([createZip(entries, exportedAt)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildExcelFilename(filename, exportedAt = new Date()) {
  return `${safeFilename(filename)}-${timestampForFilename(exportedAt)}.xlsx`;
}

export function exportJson(value, filename) {
  download(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), `${safeFilename(filename)}.json`);
}

export function displayValue(row, column) {
  const value = rawValue(row, column);
  if (Array.isArray(value)) return value.join('; ');
  return value == null ? '' : String(value);
}

function rawValue(row, column) {
  return typeof column.value === 'function' ? column.value(row) : row[column.key];
}

function worksheetRow(rowNumber, values, header) {
  const cells = values.map((value, index) => worksheetCell(rowNumber, index + 1, value, header)).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

function worksheetCell(rowNumber, columnNumber, value, header) {
  const reference = `${columnName(columnNumber)}${rowNumber}`;
  const style = header ? ' s="1"' : '';
  if (!header && typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"${style}><v>${value}</v></c>`;
  if (!header && typeof value === 'boolean') return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text.slice(0, 32767))}</t></is></c>`;
}

function columnName(number) {
  let value = number;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function timestampForFilename(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}_${values.hour}-${values.minute}-${values.second}_IST`;
}

function contentTypesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
}

function rootRelationshipsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
}

function workbookXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Compliance" sheetId="1" r:id="rId1"/></sheets></workbook>';
}

function workbookRelationshipsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF333333"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function corePropertiesXml(timestamp) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>ACA-utils</dc:creator><cp:lastModifiedBy>ACA-utils</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
}

function appPropertiesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ACA-utils</Application></Properties>';
}

function createZip(entries, date) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosTimestamp(date);
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concatenate([...localParts, ...centralParts, end]);
}

function concatenate(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[index] = crc >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeFilename(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, '-').slice(0, 90);
}

function xml(value) {
  return String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? '');
}
