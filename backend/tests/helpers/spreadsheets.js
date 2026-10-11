// Planilhas para os testes: as fantasma de fixtures/planilhas (geradas pelo Excel e pelo LibreOffice) e
// um montador de zip para arquivos hostis (zip bomb, XML com DOCTYPE, repetições patológicas).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/planilhas');

export const GHOSTS = Object.freeze({
  pagamentos: 'Controle de pagamentos 2026.xlsx',
  medicoes: 'Medições obra Residencial Aurora 2025.xlsx',
  legado: 'Controle de pagamentos 2019.xls',
  diaristas: 'Folha de diaristas - setembro 2026.csv',
  extrato: 'Extrato conta corrente - setembro 2026.csv',
  orcamento: 'Orçamento reforma do escritório.ods',
});

export function ghost(name) {
  return readFileSync(path.join(fixturesDir, name));
}

/**
 * Zip mínimo (deflate). `declaredSize` permite mentir o tamanho descompactado (zip bomb disfarçado).
 * O CRC fica zerado: o leitor não confere (só lê o que precisa e corta no teto).
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
    const data = entry.stored ? raw : deflateRawSync(raw);
    const size = entry.declaredSize ?? raw.length;
    const method = entry.stored ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** XLSX mínimo de uma aba (partes essenciais), com o XML da aba e do workbook ajustáveis. */
export function minimalXlsx({ sheetXml, workbookXml, sharedStrings } = {}) {
  return buildZip([
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      content:
        workbookXml ??
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Aba" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    },
    { name: 'xl/sharedStrings.xml', content: sharedStrings ?? '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></sst>' },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        sheetXml ??
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
    },
  ]);
}

/** ODS mínimo com o conteúdo da tabela dado (dentro de <table:table>). */
export function minimalOds(tableXml) {
  return buildZip([
    { name: 'mimetype', content: 'application/vnd.oasis.opendocument.spreadsheet', stored: true },
    {
      name: 'content.xml',
      content: `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Aba">${tableXml}</table:table></office:spreadsheet></office:body></office:document-content>`,
    },
  ]);
}
