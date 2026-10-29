export async function copyRows(rows, columns) {
  const text = toDelimited(rows, columns, '\t');
  await navigator.clipboard.writeText(text);
}

export function exportExcel(rows, columns, filename) {
  const header = columns.map((column) => `<Cell><Data ss:Type="String">${xml(column.label)}</Data></Cell>`).join('');
  const body = rows.map((row) => `<Row>${columns.map((column) => `<Cell><Data ss:Type="String">${xml(displayValue(row, column))}</Data></Cell>`).join('')}</Row>`).join('');
  const content = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Compliance"><Table><Row>${header}</Row>${body}</Table></Worksheet></Workbook>`;
  download(new Blob([content], { type: 'application/vnd.ms-excel;charset=utf-8' }), `${safeFilename(filename)}.xls`);
}

export function exportJson(value, filename) {
  download(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), `${safeFilename(filename)}.json`);
}

export function displayValue(row, column) {
  const value = typeof column.value === 'function' ? column.value(row) : row[column.key];
  if (Array.isArray(value)) return value.join('; ');
  return value == null ? '' : String(value);
}

function toDelimited(rows, columns, separator) {
  const quote = (value) => String(value ?? '').replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
  return [columns.map((column) => quote(column.label)).join(separator), ...rows.map((row) => columns.map((column) => quote(displayValue(row, column))).join(separator))].join('\n');
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
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}
