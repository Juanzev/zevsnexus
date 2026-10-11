// Coleta das linhas de UMA aba para a prévia paginada, com memória limitada:
// - só guarda as linhas da página pedida (as outras só contam);
// - linhas e colunas vazias só existem se houver conteúdo depois delas (as 16.378 colunas vazias
//   repetidas do LibreOffice e o "r=1048576" de um XLSX esparso não custam nada);
// - corta colunas no teto e células longas, e para de varrer depois do teto de linhas.
import { LIMITS } from './limits.js';

export function createCollector({ page = 1, pageSize = LIMITS.pageSize } = {}) {
  const first = (page - 1) * pageSize;
  const last = first + pageSize - 1;
  const rows = new Map();
  let totalRows = 0;
  let columns = 0;
  let truncatedColumns = false;
  let truncatedRows = false;

  return {
    /** Já passou do teto de linhas? (o leitor pode parar de alimentar). */
    get full() {
      return truncatedRows;
    },

    /**
     * @param index  linha (0 = primeira)
     * @param cells  [{ col, text }] — só as não vazias, em qualquer ordem
     */
    addRow(index, cells) {
      if (index >= LIMITS.maxRows) {
        truncatedRows = true;
        return;
      }
      const present = cells.filter((cell) => cell.text !== '');
      if (present.length === 0) return;
      totalRows = Math.max(totalRows, index + 1);
      let width = 0;
      for (const cell of present) {
        if (cell.col >= LIMITS.maxColumns) truncatedColumns = true;
        else width = Math.max(width, cell.col + 1);
      }
      columns = Math.max(columns, width);
      if (index < first || index > last) return;
      const row = rows.get(index) ?? new Map();
      for (const cell of present) {
        if (cell.col >= LIMITS.maxColumns) continue;
        const text = cell.text.length > LIMITS.maxCellChars ? `${cell.text.slice(0, LIMITS.maxCellChars)}…` : cell.text;
        row.set(cell.col, text);
      }
      rows.set(index, row);
    },

    result() {
      const end = Math.min(totalRows, last + 1);
      const pageRows = [];
      for (let index = first; index < end; index += 1) {
        const row = rows.get(index);
        pageRows.push({ number: index + 1, cells: Array.from({ length: columns }, (_, col) => row?.get(col) ?? '') });
      }
      return {
        total_rows: totalRows,
        columns,
        page,
        page_size: pageSize,
        rows: pageRows,
        truncated_rows: truncatedRows,
        truncated_columns: truncatedColumns,
      };
    },
  };
}

/** "A" → 0, "AB" → 27 (referência de célula do XLSX, ex.: "AB12"). */
export function columnIndex(reference) {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}
