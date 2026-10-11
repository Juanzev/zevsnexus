// XML de XLSX e ODS pelo saxes (sem expansão de entidade externa). Qualquer DOCTYPE é recusado:
// esses formatos nunca trazem DTD, então DOCTYPE só aparece em arquivo forjado (XXE, billion laughs).
// Nomes chegam sem prefixo de namespace ("x:row" e "row" valem igual; "table:table-cell" → "table-cell").
import { SaxesParser } from 'saxes';
import { unreadable } from './limits.js';

const CHUNK = 64 * 1024;
/** Marca de ordem de bytes (U+FEFF) que alguns geradores põem no começo do XML. */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

function localName(name) {
  const index = name.indexOf(':');
  return index === -1 ? name : name.slice(index + 1);
}

function localAttributes(attributes) {
  const result = {};
  for (const [name, value] of Object.entries(attributes)) result[localName(name)] = value;
  return result;
}

/**
 * Lê o XML chamando onOpen(nome, atributos), onClose(nome) e onText(texto).
 * @param timer  { check() } — prazo de leitura, conferido a cada bloco
 */
export function parseXml(buffer, { onOpen, onClose, onText }, timer) {
  const parser = new SaxesParser({ xmlns: false, position: false });
  let failure = null;
  parser.on('error', (err) => {
    failure ??= err;
  });
  parser.on('doctype', () => {
    failure ??= new Error('DOCTYPE não é permitido');
  });
  if (onOpen) parser.on('opentag', (node) => onOpen(localName(node.name), localAttributes(node.attributes)));
  if (onClose) parser.on('closetag', (node) => onClose(localName(node.name)));
  if (onText) {
    parser.on('text', onText);
    parser.on('cdata', onText);
  }
  const text = buffer.toString('utf8').replace(BOM, '');
  try {
    for (let index = 0; index < text.length && !failure; index += CHUNK) {
      parser.write(text.slice(index, index + CHUNK));
      timer.check();
    }
    if (!failure) parser.close();
  } catch (err) {
    if (err.code === 'SPREADSHEET_TOO_LARGE') throw err;
    failure ??= err;
  }
  if (failure) {
    if (failure.code?.startsWith?.('SPREADSHEET_')) throw failure;
    throw unreadable();
  }
}
