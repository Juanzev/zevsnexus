// Prévia de planilha (nível 2, ARCHITECTURE §13.1.1): escolhe o leitor pela extensão, com prazo.
// XLS legado não tem prévia (a biblioteca que o lê no npm tem CVEs): só armazenamento e download.
import { readCsv } from './csv.js';
import { deadline, SpreadsheetReadError } from './limits.js';
import { readOds } from './ods.js';
import { readXlsx } from './xlsx.js';

const READERS = { xlsx: readXlsx, ods: readOds, csv: readCsv };

export const PREVIEWABLE_EXTENSIONS = Object.freeze(Object.keys(READERS));

/**
 * @returns {{ sheets: {index,name,hidden}[], sheet: { index, name, total_rows, columns, page, page_size,
 *            rows: {number, cells: string[]}[], truncated_rows, truncated_columns }, csv? }}
 */
export function readSpreadsheet(buffer, extension, { sheet = 0, page = 1, pageSize } = {}) {
  const reader = READERS[extension];
  if (!reader) {
    throw new SpreadsheetReadError(
      'PREVIEW_NOT_SUPPORTED',
      extension === 'xls'
        ? 'Planilhas .xls (formato antigo do Excel) não têm prévia. Baixe o arquivo para abrir no seu programa.'
        : 'Este arquivo não tem prévia de planilha.',
    );
  }
  return reader(buffer, { sheet, page, pageSize }, deadline());
}

export { LIMITS, SpreadsheetReadError } from './limits.js';
