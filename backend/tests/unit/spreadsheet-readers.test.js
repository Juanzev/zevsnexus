// Leitores da prévia de planilha contra as planilhas fantasma (salvas pelo Excel 16 e pelo LibreOffice)
// e contra arquivos hostis montados aqui.
import { deadline } from '../../src/modules/spreadsheets/readers/limits.js';
import { readCsv } from '../../src/modules/spreadsheets/readers/csv.js';
import { formatNumber, formatSerialDate, resolveFormat } from '../../src/modules/spreadsheets/readers/format.js';
import { LIMITS, readSpreadsheet } from '../../src/modules/spreadsheets/readers/index.js';
import { buildZip, ghost, GHOSTS, minimalOds, minimalXlsx } from '../helpers/spreadsheets.js';

function read(name, extension, options) {
  return readSpreadsheet(ghost(name), extension, options);
}

function cell(result, rowNumber, column) {
  return result.sheet.rows.find((row) => row.number === rowNumber).cells[column];
}

function errorCode(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return 'sem erro';
}

describe('XLSX do Excel (planilhas fantasma)', () => {
  test('abas, título mesclado, cabeçalho na linha 4 e valores formatados em pt-BR', () => {
    const result = read(GHOSTS.pagamentos, 'xlsx');
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(['Pagamentos', 'Resumo por categoria', 'Prestadores']);
    expect(result.sheet).toMatchObject({ name: 'Pagamentos', total_rows: 125, columns: 11, page: 1, page_size: 50 });
    expect(cell(result, 1, 0)).toMatch(/^CONTROLE DE PAGAMENTOS 2026/);
    expect(result.sheet.rows[2].cells.every((value) => value === '')).toBe(true); // linha 3 vazia, mas presente
    expect(result.sheet.rows[3].cells).toEqual([
      'Lançamento',
      'Vencimento',
      'Pago em',
      'Prestador / fornecedor',
      'CPF/CNPJ',
      'Descrição',
      'Categoria',
      'Obra',
      'Valor',
      'Forma',
      'Situação',
    ]);
    expect(cell(result, 5, 1)).toMatch(/^\d{2}\/\d{2}\/2026$/); // data pelo formato da célula
    expect(cell(result, 5, 8)).toMatch(/^R\$ \d{1,3}(\.\d{3})*,\d{2}$/); // moeda
    expect(['Paga', 'Vencida', 'A vencer']).toContain(cell(result, 5, 10)); // fórmula: valor salvo
  });

  test('paginação de 50 em 50 e a linha de total (SUM com valor salvo)', () => {
    const page3 = read(GHOSTS.pagamentos, 'xlsx', { page: 3 });
    expect(page3.sheet.rows.map((row) => row.number)).toEqual(Array.from({ length: 25 }, (_, index) => 101 + index));
    expect(cell(page3, 125, 7)).toBe('TOTAL');
    expect(cell(page3, 125, 8)).toMatch(/^R\$ [\d.]+,\d{2}$/);
  });

  test('outras abas: SOMASE com valor salvo; porcentagem; item "1.1" continua texto', () => {
    const summary = read(GHOSTS.pagamentos, 'xlsx', { sheet: 1 });
    expect(summary.sheet.name).toBe('Resumo por categoria');
    expect(cell(summary, 4, 1)).toMatch(/^R\$ /);
    const measurement = read(GHOSTS.medicoes, 'xlsx', { sheet: 2 });
    expect(measurement.sheet.name).toBe('Medição 03');
    expect(cell(measurement, 7, 0)).toBe('1.1');
    expect(cell(measurement, 7, 6)).toMatch(/^\d{1,3},\d%$/);
    expect(measurement.sheet.rows.some((row) => row.cells[0].includes('\n'))).toBe(true); // observação com quebra
  });
});

describe('ODS do LibreOffice', () => {
  test('usa o texto formatado do arquivo e ignora as 16.378 colunas vazias repetidas', () => {
    const result = read(GHOSTS.orcamento, 'ods');
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(['Orçamento', 'Cronograma']);
    expect(result.sheet).toMatchObject({ columns: 6, total_rows: 11, truncated_columns: false });
    expect(cell(result, 6, 5)).toBe('R$ 5.784,00');
    expect(read(GHOSTS.orcamento, 'ods', { sheet: 1 }).sheet.rows[0].cells).toEqual(['Etapa', 'Início', 'Fim', 'Dias']);
  });
});

describe('CSV do Excel', () => {
  test('"CSV UTF-8": BOM, ponto e vírgula, números pt-BR intactos', () => {
    const result = read(GHOSTS.diaristas, 'csv');
    expect(result.csv).toEqual({ encoding: 'utf-8', delimiter: ';' });
    expect(result.sheet.rows[0].cells[0]).toBe('Nome'); // sem o BOM
    expect(cell(result, 2, 6)).toBe('4.620,00');
  });

  test('"CSV" antigo: Windows-1252 detectado (acentos certos)', () => {
    const result = read(GHOSTS.extrato, 'csv');
    expect(result.csv.encoding).toBe('windows-1252');
    expect(result.sheet.rows[0].cells).toEqual(['Data', 'Histórico', 'Documento', 'Valor', 'Saldo']);
    expect(result.sheet.rows.some((row) => row.cells[1].includes('Depósito'))).toBe(true);
  });

  test('aspas, separador e quebra dentro do campo; vírgula e tab como separador; UTF-16', () => {
    const quoted = readCsv(Buffer.from('a;b\n"x;y";"linha 1\nlinha 2"\n"com ""aspas""";z'), {}, deadline());
    expect(quoted.sheet.rows.map((row) => row.cells)).toEqual([
      ['a', 'b'],
      ['x;y', 'linha 1\nlinha 2'],
      ['com "aspas"', 'z'],
    ]);
    expect(readCsv(Buffer.from('a,b,c\n1,2,3\n'), {}, deadline()).csv.delimiter).toBe(',');
    expect(readCsv(Buffer.from('a\tb\n1\t2\n'), {}, deadline()).csv.delimiter).toBe('tab');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ação;Preço\n', 'utf16le')]);
    expect(readCsv(utf16, {}, deadline()).sheet.rows[0].cells).toEqual(['Ação', 'Preço']);
  });

  test('fórmula e HTML viram texto, nunca são interpretados', () => {
    const result = readCsv(Buffer.from('=HYPERLINK("http://x";"clique");<script>alert(1)</script>\n'), {}, deadline());
    // O 2º campo começa com aspas: vale a regra do CSV (como no Excel), e o resto segue texto.
    expect(result.sheet.rows[0].cells).toEqual(['=HYPERLINK("http://x"', 'clique)', '<script>alert(1)</script>']);
  });
});

describe('aba pedida que não existe', () => {
  test('XLSX, ODS e CSV respondem SHEET_NOT_FOUND (não "ilegível")', () => {
    expect(errorCode(() => read(GHOSTS.pagamentos, 'xlsx', { sheet: 3 }))).toBe('SHEET_NOT_FOUND');
    expect(errorCode(() => read(GHOSTS.orcamento, 'ods', { sheet: 2 }))).toBe('SHEET_NOT_FOUND');
    expect(errorCode(() => read(GHOSTS.diaristas, 'csv', { sheet: 1 }))).toBe('SHEET_NOT_FOUND');
  });
});

describe('XLS legado', () => {
  test('sem prévia: só download', () => {
    expect(errorCode(() => read(GHOSTS.legado, 'xls'))).toBe('PREVIEW_NOT_SUPPORTED');
  });
});

describe('arquivos hostis', () => {
  test('zip bomb: tamanho declarado acima do teto é recusado antes de descompactar', () => {
    const bomb = minimalXlsx();
    const declared = buildZip([{ name: 'xl/workbook.xml', content: '<x/>', declaredSize: LIMITS.maxEntryBytes + 1 }]);
    expect(errorCode(() => readSpreadsheet(declared, 'xlsx'))).toBe('SPREADSHEET_TOO_LARGE');
    expect(bomb.length).toBeGreaterThan(0);
  });

  test('zip bomb disfarçado: declara pouco, descompacta muito → o zlib corta no teto', () => {
    const huge = Buffer.alloc(LIMITS.maxEntryBytes + 1024, 0x20);
    const disguised = buildZip([
      {
        name: '_rels/.rels',
        content:
          '<Relationships><Relationship Id="r" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      },
      { name: 'xl/workbook.xml', content: huge, declaredSize: 100 },
    ]);
    expect(disguised.length).toBeLessThan(200_000);
    expect(errorCode(() => readSpreadsheet(disguised, 'xlsx'))).toBe('SPREADSHEET_TOO_LARGE');
  });

  test('XML com DOCTYPE/entidade (XXE, billion laughs) é recusado', () => {
    const xxe = minimalXlsx({
      sheetXml:
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&e;</t></is></c></row></sheetData></worksheet>',
    });
    expect(errorCode(() => readSpreadsheet(xxe, 'xlsx'))).toBe('SPREADSHEET_UNREADABLE');
  });

  test('arquivo que não é zip, ou ODS de outro tipo, é ilegível', () => {
    expect(errorCode(() => readSpreadsheet(Buffer.from('não sou um zip'), 'xlsx'))).toBe('SPREADSHEET_UNREADABLE');
    const text = buildZip([{ name: 'mimetype', content: 'application/vnd.oasis.opendocument.text', stored: true }]);
    expect(errorCode(() => readSpreadsheet(text, 'ods'))).toBe('SPREADSHEET_UNREADABLE');
  });

  test('XLSX esparso (linha 900.000) e ODS com milhões de repetições: tetos sem travar', () => {
    const sparse = minimalXlsx({
      sheetXml:
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>topo</t></is></c></row><row r="900000"><c r="ZZ900000" t="inlineStr"><is><t>longe</t></is></c></row></sheetData></worksheet>',
    });
    const started = Date.now();
    const result = readSpreadsheet(sparse, 'xlsx');
    expect(result.sheet).toMatchObject({ total_rows: 1, truncated_rows: true, truncated_columns: false, columns: 1 });

    const ods = minimalOds(
      '<table:table-row table:number-rows-repeated="1000000"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>' +
        '<table:table-row><table:table-cell table:number-columns-repeated="300"/><table:table-cell office:value-type="string"><text:p>fim</text:p></table:table-cell></table:table-row>',
    );
    expect(readSpreadsheet(ods, 'ods').sheet).toMatchObject({ total_rows: 0, truncated_rows: true });
    const wideOds = minimalOds(
      '<table:table-row><table:table-cell table:number-columns-repeated="300"/><table:table-cell office:value-type="string"><text:p>longe</text:p></table:table-cell></table:table-row>',
    );
    expect(readSpreadsheet(wideOds, 'ods').sheet).toMatchObject({ total_rows: 1, columns: 0, truncated_columns: true });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('colunas além de 200 e célula com mais de 1.000 caracteres são cortadas', () => {
    const wide = readCsv(Buffer.from(`${Array.from({ length: 250 }, (_, index) => `c${index}`).join(';')}\n${'x'.repeat(1500)}`), {}, deadline());
    expect(wide.sheet).toMatchObject({ columns: 200, truncated_columns: true });
    expect(wide.sheet.rows[1].cells[0]).toHaveLength(1001);
  });

  test('prazo de leitura estourado vira "grande demais"', () => {
    const many = Buffer.from('a;b\n'.repeat(5_000));
    expect(errorCode(() => readCsv(many, {}, deadline(-1)))).toBe('SPREADSHEET_TOO_LARGE');
  });
});

describe('formatos de número do XLSX', () => {
  test('datas (1900 e 1904), hora, porcentagem, moeda e número sem ruído', () => {
    expect(formatSerialDate(46027)).toBe('05/01/2026');
    expect(formatSerialDate(44565, { date1904: true })).toBe('05/01/2026'); // 46027 − 1462 dias
    expect(formatSerialDate(46027.75, { hasDate: true, hasTime: true })).toBe('05/01/2026 18:00');
    const none = new Map();
    expect(formatNumber(0.7917, resolveFormat(0, new Map([[0, '0.0%']])))).toBe('79,2%');
    expect(formatNumber(1234.5, resolveFormat(164, new Map([[164, '"R$"\\ #,##0.00']])))).toBe('R$ 1.234,50');
    expect(formatNumber(-39.9, resolveFormat(4, none))).toBe('-39,90');
    expect(formatNumber(0.1 + 0.2, resolveFormat(0, none))).toBe('0,3');
    expect(resolveFormat(14, none).isDate).toBe(true);
    expect(resolveFormat(0, new Map([[0, '#,##0" dias"']])).isDate).toBe(false);
  });
});
