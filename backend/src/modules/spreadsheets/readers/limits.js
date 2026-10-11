// Tetos da prévia de planilha (ARCHITECTURE §13.1.1): arquivo de terceiro é sempre suspeito.
// Estourar um teto nunca derruba o processo: vira 422 com a mensagem para baixar o arquivo.

export const LIMITS = Object.freeze({
  /** Tamanho do arquivo para prévia (conferido pelo tamanho guardado, antes de baixar). */
  maxFileBytes: 10 * 1024 * 1024,
  /** Bytes descompactados por parte do zip e no total (zip bomb). */
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxSheets: 100,
  /** Linhas varridas por aba; depois disso a prévia avisa que parou. */
  maxRows: 100_000,
  /** Colunas exibidas (as de depois são ignoradas e a tela avisa). */
  maxColumns: 200,
  maxCellChars: 1000,
  /** Textos compartilhados do XLSX. */
  maxSharedStrings: 500_000,
  /** Tempo de leitura. */
  maxMillis: 5_000,
  pageSize: 50,
});

/** Erro de leitura com o código da API (422). */
export class SpreadsheetReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpreadsheetReadError';
    this.code = code;
  }
}

export function tooLarge() {
  return new SpreadsheetReadError(
    'SPREADSHEET_TOO_LARGE',
    'Planilha grande demais para visualizar aqui. Baixe o arquivo para abrir no seu programa.',
  );
}

export function unreadable() {
  return new SpreadsheetReadError(
    'SPREADSHEET_UNREADABLE',
    'Não foi possível ler esta planilha. O arquivo pode estar corrompido ou protegido; baixe para conferir.',
  );
}

/** Aba pedida que o arquivo não tem (404 na API). */
export function sheetNotFound() {
  return new SpreadsheetReadError('SHEET_NOT_FOUND', 'Esta planilha não tem a aba pedida.');
}

/** Prazo de leitura: chame check() nos laços. */
export function deadline(millis = LIMITS.maxMillis) {
  const end = Date.now() + millis;
  return {
    check() {
      if (Date.now() > end) throw tooLarge();
    },
  };
}
