// ODS (OpenDocument): content.xml numa passada. Vale o texto já formatado que o próprio arquivo guarda
// em <text:p> ("R$ 5.784,00"); sem texto, o valor bruto. Repetições (number-rows/columns-repeated)
// só viram linhas e colunas de verdade quando há conteúdo — as vazias do fim não custam nada.
import { createCollector } from './collector.js';
import { LIMITS, sheetNotFound, tooLarge, unreadable } from './limits.js';
import { parseXml } from './xml.js';
import { openZip } from './zip.js';

const MIMETYPE = 'application/vnd.oasis.opendocument.spreadsheet';

function rawValue(attrs) {
  switch (attrs['value-type']) {
    case 'date':
      return attrs['date-value'] ?? '';
    case 'time':
      return attrs['time-value'] ?? '';
    case 'boolean':
      return attrs['boolean-value'] === 'true' ? 'VERDADEIRO' : 'FALSO';
    case 'string':
      return attrs['string-value'] ?? '';
    default:
      return attrs.value ?? '';
  }
}

export function readOds(buffer, { sheet = 0, page = 1, pageSize } = {}, timer) {
  const zip = openZip(buffer);
  const mimetype = zip.read('mimetype');
  if (mimetype && mimetype.toString('utf8').trim() !== MIMETYPE) throw unreadable();
  const content = zip.read('content.xml');
  if (!content) throw unreadable();

  const sheets = [];
  const collector = createCollector({ page, pageSize });
  let tableIndex = -1;
  let depth = 0; // tabelas aninhadas (raras) ficam de fora
  let rowIndex = 0;
  let rowRepeat = 1;
  let cells = [];
  let column = 0;
  let cell = null;
  let paragraphs = null;
  let inParagraph = false;

  const selected = () => tableIndex === sheet && depth === 1;

  parseXml(
    content,
    {
      onOpen(name, attrs) {
        if (name === 'table') {
          depth += 1;
          if (depth === 1) {
            tableIndex += 1;
            sheets.push({ index: tableIndex, name: attrs.name ?? `Aba ${tableIndex + 1}`, hidden: false });
            if (sheets.length > LIMITS.maxSheets) throw tooLarge();
            rowIndex = 0;
          }
          return;
        }
        if (!selected() || collector.full) return;
        if (name === 'table-row') {
          rowRepeat = Math.max(1, Number(attrs['number-rows-repeated'] ?? 1));
          cells = [];
          column = 0;
        } else if (name === 'table-cell' || name === 'covered-table-cell') {
          cell = { repeat: Math.max(1, Number(attrs['number-columns-repeated'] ?? 1)), raw: rawValue(attrs) };
          paragraphs = [];
        } else if (cell && name === 'p') {
          paragraphs.push('');
          inParagraph = true;
        } else if (cell && inParagraph && name === 's') {
          paragraphs[paragraphs.length - 1] += ' '.repeat(Math.min(100, Number(attrs.c ?? 1)));
        } else if (cell && inParagraph && name === 'tab') {
          paragraphs[paragraphs.length - 1] += '\t';
        } else if (cell && inParagraph && name === 'line-break') {
          paragraphs[paragraphs.length - 1] += '\n';
        }
      },
      onText(text) {
        if (cell && inParagraph) paragraphs[paragraphs.length - 1] += text;
      },
      onClose(name) {
        if (name === 'table') {
          depth -= 1;
          return;
        }
        if (!selected() || collector.full) return;
        if (name === 'p') {
          inParagraph = false;
        } else if ((name === 'table-cell' || name === 'covered-table-cell') && cell) {
          const text = paragraphs.length > 0 ? paragraphs.join('\n') : cell.raw;
          if (text !== '') {
            // Célula com conteúdo repetida (rara): repete até o teto de colunas, nunca além. Depois do
            // teto entra uma cópia só, para o coletor marcar as colunas cortadas.
            const times = Math.min(cell.repeat, Math.max(1, LIMITS.maxColumns + 1 - column));
            for (let offset = 0; offset < times; offset += 1) cells.push({ col: column + offset, text });
          }
          column += cell.repeat;
          cell = null;
        } else if (name === 'table-row') {
          if (cells.length > 0) {
            // Linha com conteúdo repetida: cada cópia conta, até o teto de linhas.
            const times = Math.min(rowRepeat, Math.max(1, LIMITS.maxRows + 1 - rowIndex));
            for (let offset = 0; offset < times; offset += 1) collector.addRow(rowIndex + offset, cells);
          }
          rowIndex += rowRepeat;
        }
      },
    },
    timer,
  );
  if (sheets.length === 0) throw unreadable();
  if (!sheets[sheet]) throw sheetNotFound();
  return { sheets, sheet: { index: sheet, name: sheets[sheet].name, ...collector.result() } };
}
