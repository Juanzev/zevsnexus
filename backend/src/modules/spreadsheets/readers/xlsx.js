// XLSX (Office Open XML): relações → workbook → textos compartilhados → estilos → aba pedida.
// Fórmulas nunca são avaliadas: vale o valor salvo em <v>. Só a aba pedida é varrida.
import path from 'node:path/posix';
import { columnIndex, createCollector } from './collector.js';
import { formatNumber, formatSerialDate, resolveFormat } from './format.js';
import { LIMITS, sheetNotFound, tooLarge, unreadable } from './limits.js';
import { parseXml } from './xml.js';
import { openZip } from './zip.js';

function relationships(zip, file, timer) {
  const buffer = zip.read(file);
  const map = new Map();
  if (!buffer) return map;
  parseXml(buffer, { onOpen: (name, attrs) => name === 'Relationship' && map.set(attrs.Id, attrs) }, timer);
  return map;
}

/** Caminho de uma relação: absoluto ("/xl/x.xml") ou relativo à pasta da parte que a declara. */
function resolveTarget(fromPart, target) {
  if (target.startsWith('/')) return target.slice(1);
  return path.normalize(path.join(path.dirname(fromPart), target));
}

function readSharedStrings(zip, file, timer) {
  const strings = [];
  const buffer = file ? zip.read(file) : null;
  if (!buffer) return strings;
  let current = null;
  let inText = false;
  let inPhonetic = false;
  parseXml(
    buffer,
    {
      onOpen(name) {
        if (name === 'si') current = '';
        else if (name === 'rPh') inPhonetic = true;
        else if (name === 't' && !inPhonetic) inText = true;
      },
      onClose(name) {
        if (name === 'si') {
          strings.push(current ?? '');
          if (strings.length > LIMITS.maxSharedStrings) throw tooLarge();
          current = null;
        } else if (name === 'rPh') inPhonetic = false;
        else if (name === 't') inText = false;
      },
      onText(text) {
        if (inText && current !== null) current += text;
      },
    },
    timer,
  );
  return strings;
}

function readStyles(zip, file, timer) {
  const customFormats = new Map();
  const cellFormats = [];
  const buffer = file ? zip.read(file) : null;
  if (!buffer) return { formats: [] };
  let inCellXfs = false;
  parseXml(
    buffer,
    {
      onOpen(name, attrs) {
        if (name === 'numFmt') customFormats.set(Number(attrs.numFmtId), attrs.formatCode ?? 'General');
        else if (name === 'cellXfs') inCellXfs = true;
        else if (name === 'xf' && inCellXfs) cellFormats.push(Number(attrs.numFmtId ?? 0));
      },
      onClose(name) {
        if (name === 'cellXfs') inCellXfs = false;
      },
    },
    timer,
  );
  return { formats: cellFormats.map((id) => resolveFormat(id, customFormats)) };
}

function cellText(cell, ctx) {
  const raw = cell.type === 'inlineStr' ? cell.inline : cell.value;
  if (raw === null || raw === undefined) return '';
  switch (cell.type) {
    case 's':
      return ctx.strings[Number(raw)] ?? '';
    case 'str':
    case 'inlineStr':
    case 'e':
      return raw;
    case 'b':
      return raw === '1' ? 'VERDADEIRO' : 'FALSO';
    case 'd': {
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? raw : formatSerialDate(date.getTime() / 86_400_000 + 25_569, { hasDate: true });
    }
    default: {
      const value = Number(raw);
      if (!Number.isFinite(value)) return raw;
      const format = ctx.styles.formats[cell.style] ?? resolveFormat(0, new Map());
      return formatNumber(value, { ...format, date1904: ctx.date1904 });
    }
  }
}

function readSheet(zip, file, ctx, options, timer) {
  const buffer = zip.read(file);
  if (!buffer) throw unreadable();
  const collector = createCollector(options);
  let rowIndex = -1;
  let cells = [];
  let cell = null;
  let column = -1;
  let field = null;
  parseXml(
    buffer,
    {
      onOpen(name, attrs) {
        if (collector.full) return;
        if (name === 'row') {
          rowIndex = attrs.r ? Number(attrs.r) - 1 : rowIndex + 1;
          cells = [];
          column = -1;
        } else if (name === 'c') {
          column = attrs.r ? columnIndex(attrs.r) : column + 1;
          cell = { col: column, type: attrs.t ?? 'n', style: Number(attrs.s ?? 0), value: null, inline: null };
        } else if (cell && name === 'v') {
          field = 'value';
          cell.value = '';
        } else if (cell && name === 't' && cell.type === 'inlineStr') {
          field = 'inline';
          cell.inline ??= '';
        }
      },
      onText(text) {
        if (cell && field) cell[field] += text;
      },
      onClose(name) {
        if (name === 'v' || name === 't') field = null;
        else if (name === 'c' && cell) {
          cells.push({ col: cell.col, text: cellText(cell, ctx) });
          cell = null;
        } else if (name === 'row' && !collector.full) collector.addRow(rowIndex, cells);
      },
    },
    timer,
  );
  return collector.result();
}

export function readXlsx(buffer, { sheet = 0, page = 1, pageSize } = {}, timer) {
  const zip = openZip(buffer);
  const rootRels = relationships(zip, '_rels/.rels', timer);
  const office = [...rootRels.values()].find((rel) => rel.Type?.endsWith('/officeDocument'));
  const workbookPart = office ? resolveTarget('', office.Target) : 'xl/workbook.xml';
  const workbook = zip.read(workbookPart);
  if (!workbook) throw unreadable();

  const sheets = [];
  let date1904 = false;
  parseXml(
    workbook,
    {
      onOpen(name, attrs) {
        if (name === 'workbookPr') date1904 = attrs.date1904 === '1' || attrs.date1904 === 'true';
        else if (name === 'sheet') {
          sheets.push({ name: attrs.name ?? `Aba ${sheets.length + 1}`, rel: attrs.id, hidden: (attrs.state ?? 'visible') !== 'visible' });
          if (sheets.length > LIMITS.maxSheets) throw tooLarge();
        }
      },
    },
    timer,
  );
  if (sheets.length === 0) throw unreadable();

  const workbookRels = relationships(zip, path.join(path.dirname(workbookPart), '_rels', `${path.basename(workbookPart)}.rels`), timer);
  const partOf = (type) => {
    const rel = [...workbookRels.values()].find((item) => item.Type?.endsWith(`/${type}`));
    return rel ? resolveTarget(workbookPart, rel.Target) : null;
  };
  const selected = sheets[sheet];
  if (!selected) throw sheetNotFound();
  const sheetRel = workbookRels.get(selected.rel);
  if (!sheetRel) throw unreadable();

  const ctx = {
    strings: readSharedStrings(zip, partOf('sharedStrings'), timer),
    styles: readStyles(zip, partOf('styles'), timer),
    date1904,
  };
  return {
    sheets: sheets.map((item, index) => ({ index, name: item.name, hidden: item.hidden })),
    sheet: { index: sheet, name: selected.name, ...readSheet(zip, resolveTarget(workbookPart, sheetRel.Target), ctx, { page, pageSize }, timer) },
  };
}
