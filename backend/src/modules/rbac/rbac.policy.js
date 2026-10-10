// Anti-escalada de privilégio (pág. 05, regras testadas no Wash). Funções puras: o service de
// equipe (F10) trava a membership-alvo com FOR UPDATE, chama assertCanChangeAccess e grava a
// auditoria na mesma transação.
import { AuthorizationError, ConflictError } from '../../shared/errors.js';
import { rolePermissions } from './rbac.catalog.js';

/** Permissões efetivas = (papéis ∪ grants) − denies. */
export function effectivePermissions({ roles = [], grants = [], denies = [] }) {
  const result = rolePermissions(roles);
  grants.forEach((code) => result.add(code));
  denies.forEach((code) => result.delete(code));
  return result;
}

function missingFrom(actorPermissions, required) {
  return [...required].filter((code) => !actorPermissions.has(code));
}

/**
 * @param actor   { membershipId, roles, permissions: Set }  quem altera
 * @param target  { membershipId, roles, grants, denies }  acesso atual do alvo
 * @param next    { roles, grants, denies }  acesso pedido para o alvo
 * @param otherActiveOwners  quantos outros owners ativos a empresa tem além do alvo
 */
export function assertCanChangeAccess({ actor, target, next, otherActiveOwners }) {
  // 1. Ninguém altera o próprio acesso.
  if (actor.membershipId === target.membershipId) {
    throw new AuthorizationError('CANNOT_CHANGE_SELF', 'Você não pode alterar o próprio acesso.');
  }

  // 3. Só quem é owner mexe em owner (admin tem as mesmas permissões, mas não o papel);
  //    ninguém gerencia quem tem permissões que ele não tem.
  if (target.roles.includes('owner') && !actor.roles.includes('owner')) {
    throw new AuthorizationError('OWNER_PROTECTED', 'Só um proprietário pode alterar outro proprietário.');
  }
  if (missingFrom(actor.permissions, effectivePermissions(target)).length > 0) {
    throw new AuthorizationError('TARGET_OUTRANKS', 'Esta pessoa tem permissões que você não tem.');
  }

  // 2. Ninguém concede o que não tem (por papel ou grant). Deny é sempre permitido.
  const granted = effectivePermissions({ roles: next.roles, grants: next.grants });
  const escalated = missingFrom(actor.permissions, granted);
  if (escalated.length > 0) {
    throw new AuthorizationError('PRIVILEGE_ESCALATION', 'Você não pode conceder permissões que não tem.');
  }

  // 4. A empresa nunca fica sem owner ativo.
  if (target.roles.includes('owner') && !next.roles.includes('owner') && otherActiveOwners === 0) {
    throw new ConflictError('LAST_OWNER', 'A empresa precisa ter pelo menos um proprietário.');
  }
}
