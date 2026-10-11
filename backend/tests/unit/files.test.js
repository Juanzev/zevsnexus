import {
  ALLOWED_EXTENSIONS,
  contentDisposition,
  extensionOf,
  isInlineAllowed,
  matchesSignature,
  resolveFileType,
  sanitizeFilename,
  titleFromFilename,
} from '../../src/shared/files.js';
import { FIXTURES } from '../helpers/documents.js';

describe('allowlist de tipos', () => {
  test('aceita só a lista da ARCHITECTURE §10.2', () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual(
      ['csv', 'doc', 'docx', 'jpeg', 'jpg', 'ods', 'odt', 'pdf', 'png', 'txt', 'webp', 'xls', 'xlsx', 'xml'].sort(),
    );
  });

  test.each([
    'virus.exe',
    'script.js',
    'pagina.html',
    'pagina.htm',
    'imagem.svg',
    'macro.xlsm',
    'macro.docm',
    'pacote.zip',
    'sem-extensao',
    'contrato.pdf.exe',
  ])('recusa %s', (filename) => {
    expect(resolveFileType(filename, '').error).toMatch(/não aceito/);
  });

  test('o tipo é decidido pelo servidor, pela extensão', () => {
    expect(resolveFileType('Contrato.PDF', 'application/pdf')).toEqual({ extension: 'pdf', contentType: 'application/pdf' });
    expect(resolveFileType('foto.jpeg', '')).toEqual({ extension: 'jpeg', contentType: 'image/jpeg' });
    expect(resolveFileType('nota.xml', 'text/xml')).toEqual({ extension: 'xml', contentType: 'application/xml' });
  });

  test('MIME vazio ou genérico vale a extensão; MIME de outro tipo é recusado', () => {
    expect(resolveFileType('planilha.xlsx', 'application/octet-stream').extension).toBe('xlsx');
    // No Windows, CSV chega como application/vnd.ms-excel.
    expect(resolveFileType('extrato.csv', 'application/vnd.ms-excel').contentType).toBe('text/csv');
    expect(resolveFileType('contrato.pdf', 'text/html').error).toMatch(/não corresponde/);
    expect(resolveFileType('foto.png', 'image/svg+xml').error).toMatch(/não corresponde/);
  });
});

describe('magic bytes', () => {
  test.each([
    ['pdf', FIXTURES.pdf()],
    ['png', FIXTURES.png()],
    ['jpg', FIXTURES.jpg()],
    ['xlsx', FIXTURES.xlsx()],
    ['docx', FIXTURES.xlsx()],
    ['csv', FIXTURES.csv()],
    ['xml', FIXTURES.xml()],
    ['txt', FIXTURES.txt()],
    ['webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')],
    ['xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])],
  ])('%s confere', (extension, bytes) => {
    expect(matchesSignature(extension, bytes)).toBe(true);
  });

  test('conteúdo que não bate com a extensão é recusado', () => {
    expect(matchesSignature('pdf', Buffer.from('<html><script>alert(1)</script></html>'))).toBe(false);
    expect(matchesSignature('png', FIXTURES.pdf())).toBe(false);
    expect(matchesSignature('xlsx', FIXTURES.pdf())).toBe(false);
    expect(matchesSignature('csv', Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(false); // executável (MZ)
    expect(matchesSignature('xml', Buffer.from('não é xml'))).toBe(false);
    expect(matchesSignature('pdf', Buffer.alloc(0))).toBe(false);
    expect(matchesSignature('exe', Buffer.from('MZ'))).toBe(false);
  });
});

describe('nome do arquivo', () => {
  test('tira controles e separadores de caminho', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('-..-etc-passwd');
    expect(sanitizeFilename('nota\r\nfiscal\u0000.pdf')).toBe('notafiscal.pdf');
    expect(sanitizeFilename('  Contrato   final .pdf ')).toBe('Contrato final .pdf');
    expect(sanitizeFilename('')).toBe('arquivo');
    expect(sanitizeFilename('...')).toBe('arquivo');
    expect(sanitizeFilename('.pdf')).toBe('arquivo.pdf');
  });

  test('corta em 200 caracteres preservando a extensão', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.pdf`);
    expect(name).toHaveLength(200);
    expect(extensionOf(name)).toBe('pdf');
  });

  test('título padrão é o nome sem extensão', () => {
    expect(titleFromFilename('Contrato de prestação.pdf')).toBe('Contrato de prestação');
    expect(titleFromFilename('.pdf')).toBe('arquivo');
  });

  test('Content-Disposition sem quebra de linha e com nome UTF-8 (RFC 5987)', () => {
    const header = contentDisposition('attachment', 'Relatório "final"\r\nSet-Cookie: x.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(header).toContain(encodeURIComponent('Relatório'));
    expect(contentDisposition('inline', 'a.pdf')).toMatch(/^inline;/);
    expect(contentDisposition('qualquer', 'a.pdf')).toMatch(/^attachment;/);
  });

  test('inline só para PDF e imagem', () => {
    expect(['pdf', 'png', 'jpg', 'jpeg', 'webp'].every(isInlineAllowed)).toBe(true);
    expect(['xml', 'csv', 'txt', 'xlsx', 'docx', 'html'].some(isInlineAllowed)).toBe(false);
  });
});
