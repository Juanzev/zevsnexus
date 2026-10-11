// Chaves do storage (ARCHITECTURE §10.2): geradas só pelo servidor, sem nome original nem extensão.
//   companies/<company_id>/files/<file_id>    definitiva: só o servidor escreve (cópia na confirmação)
//   companies/<company_id>/uploads/<file_id>  de envio: a única que recebe URL de PUT
import { isUuid } from '../../shared/db.js';

const KEY = /^companies\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(files|uploads)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function build(kind, companyId, fileId) {
  if (!isUuid(companyId) || !isUuid(fileId)) throw new Error('storage: companyId e fileId precisam ser UUID');
  return `companies/${companyId.toLowerCase()}/${kind}/${fileId.toLowerCase()}`;
}

export function fileKey(companyId, fileId) {
  return build('files', companyId, fileId);
}

export function uploadKey(companyId, fileId) {
  return build('uploads', companyId, fileId);
}

/** Toda operação de provider passa por aqui: nenhuma chave fora do formato chega ao storage. */
export function assertKey(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('storage: chave fora do formato');
  return key;
}
