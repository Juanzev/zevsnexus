// Política de arquivos (ARCHITECTURE §10): allowlist por extensão, tipo decidido pelo servidor,
// conferência por magic bytes e nome seguro para exibir e baixar.
// Bloqueados por omissão: executáveis, scripts, HTML, SVG, arquivos com macro e compactados.

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * extensão → { contentType canônico, MIMEs aceitos do navegador, assinatura, inline? }
 * Navegadores mandam MIME vazio ou "genérico" para alguns tipos: por isso a lista de aceitos.
 */
export const FILE_TYPES = Object.freeze({
  pdf: { contentType: 'application/pdf', accepts: ['application/pdf'], signature: 'pdf', inline: true },
  jpg: { contentType: 'image/jpeg', accepts: ['image/jpeg', 'image/pjpeg'], signature: 'jpeg', inline: true },
  jpeg: { contentType: 'image/jpeg', accepts: ['image/jpeg', 'image/pjpeg'], signature: 'jpeg', inline: true },
  png: { contentType: 'image/png', accepts: ['image/png'], signature: 'png', inline: true },
  webp: { contentType: 'image/webp', accepts: ['image/webp'], signature: 'webp', inline: true },
  xml: { contentType: 'application/xml', accepts: ['application/xml', 'text/xml'], signature: 'xml' },
  csv: {
    contentType: 'text/csv',
    accepts: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
    signature: 'text',
  },
  txt: { contentType: 'text/plain', accepts: ['text/plain'], signature: 'text' },
  xlsx: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    accepts: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    signature: 'zip',
  },
  xls: { contentType: 'application/vnd.ms-excel', accepts: ['application/vnd.ms-excel'], signature: 'ole' },
  ods: {
    contentType: 'application/vnd.oasis.opendocument.spreadsheet',
    accepts: ['application/vnd.oasis.opendocument.spreadsheet'],
    signature: 'zip',
  },
  docx: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    accepts: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    signature: 'zip',
  },
  doc: { contentType: 'application/msword', accepts: ['application/msword'], signature: 'ole' },
  odt: {
    contentType: 'application/vnd.oasis.opendocument.text',
    accepts: ['application/vnd.oasis.opendocument.text'],
    signature: 'zip',
  },
});

export const ALLOWED_EXTENSIONS = Object.freeze(Object.keys(FILE_TYPES));
export const SPREADSHEET_EXTENSIONS = Object.freeze(['xlsx', 'xls', 'csv', 'ods']);
/** Bytes lidos do início do arquivo para conferir a assinatura. */
export const SIGNATURE_BYTES = 4096;

export function extensionOf(filename) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(filename ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Confere extensão e MIME declarado. Devolve { extension, contentType } com o tipo canônico,
 * ou { error } com a mensagem para o usuário.
 */
export function resolveFileType(filename, declaredType) {
  const extension = extensionOf(filename);
  const type = FILE_TYPES[extension];
  if (!type) {
    return { error: `Tipo de arquivo não aceito (.${extension || '?'}). Aceitos: ${ALLOWED_EXTENSIONS.join(', ')}.` };
  }
  const declared = String(declaredType ?? '').split(';')[0].trim().toLowerCase();
  // MIME vazio ou genérico: o navegador não soube dizer; vale a extensão (e os magic bytes depois).
  if (declared && declared !== 'application/octet-stream' && !type.accepts.includes(declared)) {
    return { error: 'O conteúdo do arquivo não corresponde à extensão.' };
  }
  return { extension, contentType: type.contentType };
}

function startsWith(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function looksLikeText(bytes) {
  for (const byte of bytes) {
    // NUL e controles fora de TAB/LF/CR/FF não aparecem em texto.
    if (byte === 0 || (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(byte))) return false;
  }
  return true;
}

function stripBom(bytes) {
  return startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
}

/** true se os primeiros bytes batem com o formato esperado para a extensão. */
export function matchesSignature(extension, bytes) {
  const type = FILE_TYPES[extension];
  if (!type || !bytes || bytes.length === 0) return false;
  switch (type.signature) {
    case 'pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case 'zip':
      return startsWith(bytes, ZIP);
    case 'ole':
      return startsWith(bytes, OLE);
    case 'xml': {
      const text = stripBom(bytes);
      if (!looksLikeText(text)) return false;
      return /^\s*</.test(Buffer.from(text).toString('utf8', 0, 256));
    }
    case 'text':
      return looksLikeText(stripBom(bytes));
    default:
      return false;
  }
}

export function isInlineAllowed(extension) {
  return Boolean(FILE_TYPES[extension]?.inline);
}

/** Nome para exibir: sem caracteres de controle nem separadores de caminho, até 200 caracteres. */
export function sanitizeFilename(filename) {
  const withoutControls = [...String(filename ?? '').normalize('NFC')]
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('');
  const cleaned = withoutControls
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  // Sem ponto inicial (arquivo oculto); ".pdf" vira "arquivo.pdf", não "pdf".
  let safe = cleaned.replace(/^\.+/, '');
  if (!extensionOf(safe) && extensionOf(cleaned)) safe = `arquivo.${extensionOf(cleaned)}`;
  safe ||= 'arquivo';
  if (safe.length <= 200) return safe;
  const extension = extensionOf(safe);
  return extension ? `${safe.slice(0, 199 - extension.length)}.${extension}` : safe.slice(0, 200);
}

/** Título padrão de um documento: o nome do arquivo sem a extensão. */
export function titleFromFilename(filename) {
  return sanitizeFilename(filename).replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'Documento';
}

/** Content-Disposition seguro (RFC 6266/5987): ASCII de reserva + nome UTF-8 codificado. */
export function contentDisposition(disposition, filename) {
  const name = sanitizeFilename(filename);
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'arquivo';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition === 'inline' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
