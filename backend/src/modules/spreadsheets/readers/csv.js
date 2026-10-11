// CSV como o Excel brasileiro grava: "CSV UTF-8" (BOM, ";") ou "CSV" antigo (Windows-1252, ";").
// Codificação: BOM UTF-8 ou UTF-16; sem BOM, UTF-8 se for válido, senão Windows-1252.
// Separador detectado entre ; , tab e | (o mais constante nas primeiras linhas). Aspas como na RFC 4180.
import { createCollector } from './collector.js';
import { LIMITS, sheetNotFound } from './limits.js';

const DELIMITERS = [';', ',', '\t', '|'];

export function decodeText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.toString('utf8', 3), encoding: 'utf-8' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
  }
}

/** Conta o separador fora de aspas em cada linha da amostra; vence o mais frequente e constante. */
export function detectDelimiter(text) {
  const sample = text.slice(0, 64 * 1024).split(/\r\n|\n|\r/).filter((line) => line.trim() !== '').slice(0, 20);
  let best = { delimiter: ';', score: 0 };
  for (const delimiter of DELIMITERS) {
    const counts = sample.map((line) => {
      let count = 0;
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (char === delimiter && !quoted) count += 1;
      }
      return count;
    });
    const lines = counts.filter((count) => count > 0).length;
    const consistent = counts.filter((count) => count === counts[0]).length;
    const score = counts[0] > 0 ? lines * 10 + consistent : 0;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** Linhas do CSV (gerador): campos com aspas podem ter separador e quebra de linha dentro. */
function* records(text, delimiter, timer) {
  let field = '';
  let row = [];
  let quoted = false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      yield row;
      row = [];
      field = '';
      count += 1;
      if (count % 1000 === 0) timer.check();
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

export function readCsv(buffer, { sheet = 0, page = 1, pageSize } = {}, timer) {
  if (sheet !== 0) throw sheetNotFound(); // CSV tem uma aba só
  const { text, encoding } = decodeText(buffer);
  const delimiter = detectDelimiter(text);
  const collector = createCollector({ page, pageSize });
  let index = 0;
  for (const row of records(text, delimiter, timer)) {
    collector.addRow(
      index,
      row.slice(0, LIMITS.maxColumns + 1).map((value, col) => ({ col, text: value })),
    );
    if (collector.full) break;
    index += 1;
  }
  return {
    sheets: [{ index: 0, name: 'Planilha', hidden: false }],
    sheet: { index: 0, name: 'Planilha', ...collector.result() },
    csv: { encoding, delimiter: delimiter === '\t' ? 'tab' : delimiter },
  };
}
