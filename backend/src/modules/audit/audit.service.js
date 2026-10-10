// Auditoria (pág. 06 §11–§12): gravada NA MESMA TRANSAÇÃO da mudança (passe o client da transação).
// O metadata nunca leva o valor de um dado pessoal: registra que mudou, quem e quando.
import { auditRepository } from './audit.repository.js';

export const PERSONAL_DATA = '[dado pessoal]';

/**
 * @param db   client da transação (ou pool, quando não há transação)
 * @param ctx  requestContext(req) — quem age e de onde
 * @param event { action, entityType, entityId, companyId?, actorUserId?, actorType?, metadata? }
 */
export async function recordAudit(db, ctx, event) {
  await auditRepository(db).insert({
    companyId: event.companyId !== undefined ? event.companyId : (ctx?.companyId ?? null),
    actorType: event.actorType ?? ctx?.actorType ?? 'user',
    actorUserId: event.actorUserId !== undefined ? event.actorUserId : (ctx?.userId ?? null),
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    requestId: ctx?.requestId ?? null,
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    metadata: event.metadata ?? {},
  });
}

/**
 * Diferença campo a campo entre `before` e `after` (só `fields`). Campos em `personal` registram
 * apenas que mudaram. Devolve null se nada mudou.
 */
export function auditChanges(before, after, { fields, personal = [] }) {
  const changes = {};
  for (const field of fields) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (from === to) continue;
    changes[field] = personal.includes(field) ? PERSONAL_DATA : { from, to };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export function countRecentAudit(db, filter) {
  return auditRepository(db).countRecent(filter);
}
