// Envio de arquivos (ARCHITECTURE §5.2): intenção na API → PUT direto no storage (URL assinada,
// com progresso) → confirmação na operação que usa o arquivo (documento novo ou nova versão).
// O arquivo nunca passa pela API; a URL assinada não é guardada nem registrada.
import { api, newIdempotencyKey } from './api.js';
import { ApiError } from './api-error.js';

/** Extensões aceitas (o backend confere de novo: extensão, MIME e magic bytes). */
export const ACCEPTED_EXTENSIONS = Object.freeze([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'xml',
  'csv',
  'txt',
  'xlsx',
  'xls',
  'ods',
  'docx',
  'doc',
  'odt',
]);
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const SPREADSHEET_EXTENSIONS = Object.freeze(['xlsx', 'xls', 'csv', 'ods']);
export const SPREADSHEET_ACCEPT = SPREADSHEET_EXTENSIONS.map((extension) => `.${extension}`).join(',');

function extensionOf(file) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(file.name);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Ano de referência sugerido para planilha: o da última modificação do arquivo (uma planilha de 2019
 * enviada hoje continua sendo de 2019). Fora do intervalo aceito, o backend usa o ano corrente.
 */
export function referenceYearOf(file) {
  if (!SPREADSHEET_EXTENSIONS.includes(extensionOf(file)) || !file.lastModified) return undefined;
  const year = new Date(file.lastModified).getFullYear();
  return year >= 1990 && year <= 2100 ? year : undefined;
}

/** PUT com progresso (fetch não informa progresso de envio). */
function putFile({ url, method, headers }, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError({ status: xhr.status, code: 'UPLOAD_FAILED', message: 'O envio do arquivo falhou. Tente de novo.' }));
    });
    xhr.addEventListener('error', () => reject(ApiError.network()));
    xhr.addEventListener('abort', () => reject(new ApiError({ status: 0, code: 'UPLOAD_ABORTED', message: 'Envio cancelado.' })));
    xhr.send(file);
  });
}

/** Intenção + PUT direto no storage. Devolve o file_id, que a operação seguinte confirma. */
export async function uploadFile(file, { onProgress } = {}) {
  return sendToStorage(file, onProgress);
}

async function sendToStorage(file, onProgress) {
  const { data } = await api('/files/upload-intents', {
    method: 'POST',
    body: { filename: file.name, size_bytes: file.size, content_type: file.type || null },
  });
  await putFile(data.upload, file, onProgress);
  return data.file.id;
}

/** Envia um arquivo e cria o documento (na pasta dada, ou na raiz). */
export async function uploadDocument(file, { folderId = null, onProgress } = {}) {
  const fileId = await sendToStorage(file, onProgress);
  const { data } = await api('/documents', {
    method: 'POST',
    body: { file_id: fileId, folder_id: folderId, reference_year: referenceYearOf(file) },
    idempotencyKey: newIdempotencyKey(),
  });
  return data.document;
}

/** Envia um arquivo como nova versão de um documento. */
export async function uploadVersion(documentId, file, { comment = null, onProgress } = {}) {
  const fileId = await sendToStorage(file, onProgress);
  const { data } = await api(`/documents/${documentId}/versions`, {
    method: 'POST',
    body: { file_id: fileId, comment, reference_year: referenceYearOf(file) },
    idempotencyKey: newIdempotencyKey(),
  });
  return data.document;
}

/** Extensão aceita? (aviso imediato; a regra de verdade é do backend). */
export function isAcceptedFile(file) {
  return ACCEPTED_EXTENSIONS.includes(extensionOf(file));
}

export function isSpreadsheetFile(file) {
  return SPREADSHEET_EXTENSIONS.includes(extensionOf(file));
}

/**
 * Abre ou baixa um documento. A aba é aberta já no clique (senão o navegador bloqueia o pop-up)
 * e só depois recebe a URL curta; `opener` é cortado antes de navegar.
 */
export async function openDocument(documentId, { version, inline = false } = {}) {
  const win = inline ? window.open('', '_blank') : null;
  if (win) win.opener = null;
  try {
    const body = { disposition: inline ? 'inline' : 'attachment' };
    if (version) body.version = version;
    const { data } = await api(`/documents/${documentId}/download-url`, { method: 'POST', body });
    if (win) win.location.href = data.url;
    else window.location.assign(data.url);
  } catch (err) {
    win?.close();
    throw err;
  }
}
