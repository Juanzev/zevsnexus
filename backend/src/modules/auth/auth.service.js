// Regras da autenticação (pág. 04, ADR-007):
// - access token curto em memória + refresh opaco rotacionado em cookie;
// - reuso de refresh fora da janela de tolerância revoga a família inteira;
// - cadastro, login e recuperação de senha não revelam se um e-mail existe;
// - eventos de conta vão para a auditoria (company_id nulo), sem dado pessoal no metadata.
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { pool, UNIQUE_VIOLATION, withTransaction } from '../../shared/db.js';
import { AppError, AuthenticationError, AuthorizationError, ValidationError } from '../../shared/errors.js';
import { securityEvent } from '../../shared/logger.js';
import { generateOpaqueToken, hashToken, signAccessToken } from '../../shared/security/tokens.js';
import { countRecentAudit, recordAudit } from '../audit/audit.service.js';
import { sendEmailLater } from '../email/email.service.js';
import { listCompaniesForUser } from '../memberships/memberships.service.js';
import { isPlatformAdmin } from '../platform/platform.service.js';
import {
  accountExistsMessage,
  passwordChangedMessage,
  passwordResetMessage,
  sessionReuseAlertMessage,
  verifyEmailMessage,
} from './auth.emails.js';
import { authRepository } from './auth.repository.js';
import { hashPassword, verifyPassword } from './password.js';

/** Reuso de um refresh rotacionado há até 15 s é corrida entre abas, não ataque. */
export const REUSE_GRACE_SECONDS = 15;
const RESET_TOKEN_TTL_SECONDS = 60 * 60;
const VERIFICATION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Teto de e-mails de aviso/recuperação por destinatário (contra uso da conta como "bombardeio" de e-mail). */
const EMAILS_PER_RECIPIENT_PER_HOUR = 3;

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    email_verified: Boolean(user.email_verified_at),
    created_at: user.created_at,
  };
}

function isActive(user) {
  return Boolean(user) && user.status === 'active';
}

function invalidRefresh() {
  return new AuthenticationError('REFRESH_INVALID', 'Sua sessão terminou. Faça login novamente.');
}

/** Evento de conta: sem empresa; `actorUserId` nulo quando quem age é anônimo (ex.: login errado). */
function auditAccount(db, ctx, action, userId, { actorUserId = userId, metadata } = {}) {
  return recordAudit(db, ctx, {
    companyId: null,
    actorType: 'user',
    actorUserId,
    action,
    entityType: 'user',
    entityId: userId,
    metadata,
  });
}

async function recentlyAudited(action, userId) {
  return (await countRecentAudit(pool, { action, entityId: userId, seconds: 3600 })) >= EMAILS_PER_RECIPIENT_PER_HOUR;
}

/** Abre uma família de refresh nova e emite o par de tokens. */
async function startSession(repo, user, ctx) {
  const refreshToken = generateOpaqueToken();
  const created = await repo.insertRefreshToken({
    userId: user.id,
    familyId: randomUUID(),
    tokenHash: hashToken(refreshToken),
    ttlSeconds: env.REFRESH_TOKEN_EXPIRES_IN,
    familyMaxAgeSeconds: env.REFRESH_FAMILY_MAX_AGE,
    familyExpiresAt: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return {
    user: publicUser(user),
    accessToken: signAccessToken(user.id),
    refreshToken,
    refreshExpiresAt: created.expires_at,
  };
}

async function issueVerificationToken(repo, user) {
  const token = generateOpaqueToken(32);
  await repo.invalidateVerificationTokens(user.id);
  await repo.insertVerificationToken({
    userId: user.id,
    email: user.email,
    tokenHash: hashToken(token),
    ttlSeconds: VERIFICATION_TOKEN_TTL_SECONDS,
  });
  return token;
}

/**
 * Cadastro. A resposta é a mesma para e-mail novo e já cadastrado; o dono de um e-mail já
 * cadastrado recebe um aviso (no máximo 3 por hora). O login antes da verificação é permitido;
 * cadastrar empresa, não.
 */
export async function register({ name, email, password }, ctx) {
  // Hash antes de consultar: o tempo de resposta não revela se o e-mail existe.
  const passwordHash = await hashPassword(password);
  const existing = await authRepository().findUserByEmail(email);
  if (existing) {
    const throttled = await recentlyAudited('auth.register_existing', existing.id);
    await auditAccount(pool, ctx, 'auth.register_existing', existing.id, { actorUserId: null, metadata: { throttled } });
    if (!throttled) sendEmailLater(accountExistsMessage(existing));
    return;
  }
  let created;
  try {
    created = await withTransaction(async (client) => {
      const repo = authRepository(client);
      const user = await repo.insertUser({ name, email, passwordHash });
      const token = await issueVerificationToken(repo, user);
      await auditAccount(client, ctx, 'auth.registered', user.id);
      return { user, token };
    });
  } catch (err) {
    // Corrida com outro cadastro do mesmo e-mail: mesma resposta, nada a enviar.
    if (err.code === UNIQUE_VIOLATION) return;
    throw err;
  }
  sendEmailLater(verifyEmailMessage(created.user, created.token));
}

export async function login({ email, password }, ctx) {
  const user = await authRepository().findUserByEmail(email);
  const passwordOk = await verifyPassword(password, user?.password_hash);
  if (!user || !passwordOk) {
    if (user) await auditAccount(pool, ctx, 'auth.login_failed', user.id, { actorUserId: null });
    throw new AuthenticationError('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
  }
  // Só quem acertou a senha descobre que a conta está desativada.
  if (!isActive(user)) {
    throw new AuthorizationError('ACCOUNT_DISABLED', 'Esta conta está desativada. Fale com o suporte.');
  }
  return withTransaction(async (client) => {
    const repo = authRepository(client);
    const session = await startSession(repo, user, ctx);
    await repo.updateLastLogin(user.id);
    await auditAccount(client, ctx, 'auth.login', user.id);
    return session;
  });
}

export async function refresh(rawToken, ctx) {
  if (!rawToken) throw invalidRefresh();

  const outcome = await withTransaction(async (client) => {
    const repo = authRepository(client);
    const token = await repo.findRefreshTokenForUpdate(hashToken(rawToken), REUSE_GRACE_SECONDS);
    if (!token || token.revoked_at || token.family_expired) return { kind: 'invalid' };

    if (token.replaced_by_id) {
      if (token.within_grace) return { kind: 'grace', userId: token.user_id };
      // Revogação e auditoria gravadas antes do erro: por isso o desfecho sai da transação como valor.
      await repo.revokeFamily(token.family_id, 'reuse');
      await auditAccount(client, ctx, 'auth.refresh_reuse', token.user_id, {
        actorUserId: null,
        metadata: { family_id: token.family_id },
      });
      return { kind: 'reuse', userId: token.user_id, familyId: token.family_id };
    }

    if (token.expired) return { kind: 'invalid' };
    const user = await repo.findUserById(token.user_id);
    if (!isActive(user)) return { kind: 'invalid' };

    const nextToken = generateOpaqueToken();
    const created = await repo.insertRefreshToken({
      userId: user.id,
      familyId: token.family_id,
      tokenHash: hashToken(nextToken),
      ttlSeconds: env.REFRESH_TOKEN_EXPIRES_IN,
      familyMaxAgeSeconds: env.REFRESH_FAMILY_MAX_AGE,
      familyExpiresAt: token.family_expires_at,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    await repo.markRotated(token.id, created.id);
    return { kind: 'rotated', user, refreshToken: nextToken, refreshExpiresAt: created.expires_at };
  });

  switch (outcome.kind) {
    case 'rotated':
      return {
        user: publicUser(outcome.user),
        accessToken: signAccessToken(outcome.user.id),
        refreshToken: outcome.refreshToken,
        refreshExpiresAt: outcome.refreshExpiresAt,
      };
    case 'grace': {
      // A outra aba já recebeu o cookie novo: devolve só um access token, sem rotacionar.
      const user = await authRepository().findUserById(outcome.userId);
      if (!isActive(user)) throw invalidRefresh();
      return { user: publicUser(user), accessToken: signAccessToken(user.id), refreshToken: null };
    }
    case 'reuse': {
      securityEvent('auth.refresh_reuse', { userId: outcome.userId, familyId: outcome.familyId, ip: ctx.ip });
      const user = await authRepository().findUserById(outcome.userId);
      if (user) sendEmailLater(sessionReuseAlertMessage(user));
      throw new AuthenticationError('REFRESH_REUSED', 'Sua sessão foi encerrada por segurança. Faça login novamente.');
    }
    default:
      throw invalidRefresh();
  }
}

export async function logout(rawToken, ctx) {
  if (!rawToken) return;
  await withTransaction(async (client) => {
    const repo = authRepository(client);
    const token = await repo.findRefreshToken(hashToken(rawToken));
    if (!token) return;
    await repo.revokeFamily(token.family_id, 'logout');
    await auditAccount(client, ctx, 'auth.logout', token.user_id);
  });
}

/** Encerra todas as sessões: refresh de todas as famílias e access tokens já emitidos. */
export async function logoutAll(user, ctx) {
  await withTransaction(async (client) => {
    const repo = authRepository(client);
    await repo.revokeAllRefreshTokens(user.id, 'logout_all');
    await repo.setSessionsRevokedAt(user.id, new Date());
    await auditAccount(client, ctx, 'auth.logout_all', user.id);
  });
}

/** Sempre a mesma resposta; o e-mail só sai se a conta existir, estiver ativa e abaixo do teto por hora. */
export async function requestPasswordReset({ email }, ctx) {
  const user = await authRepository().findUserByEmail(email);
  if (!isActive(user)) return;
  const throttled = await recentlyAudited('auth.password_reset_requested', user.id);
  if (throttled) {
    await auditAccount(pool, ctx, 'auth.password_reset_requested', user.id, { actorUserId: null, metadata: { throttled } });
    return;
  }
  const token = generateOpaqueToken(32);
  await withTransaction(async (client) => {
    const repo = authRepository(client);
    await repo.invalidateResetTokens(user.id);
    await repo.insertResetToken({
      userId: user.id,
      tokenHash: hashToken(token),
      ttlSeconds: RESET_TOKEN_TTL_SECONDS,
      ip: ctx.ip,
    });
    await auditAccount(client, ctx, 'auth.password_reset_requested', user.id, { actorUserId: null, metadata: { throttled } });
  });
  sendEmailLater(passwordResetMessage(user, token));
}

/**
 * Redefine a senha com o token do e-mail: uso único, só o mais recente vale, todas as sessões caem.
 * Como o token prova o controle da caixa de e-mail, o e-mail passa a contar como verificado.
 */
export async function resetPassword({ token, password }, ctx) {
  const passwordHash = await hashPassword(password);
  const user = await withTransaction(async (client) => {
    const repo = authRepository(client);
    const resetToken = await repo.findResetTokenForUpdate(hashToken(token));
    if (!resetToken?.usable) return null;
    const owner = await repo.findUserById(resetToken.user_id);
    if (!isActive(owner)) return null;
    await repo.markResetTokenUsed(resetToken.id);
    await repo.invalidateResetTokens(owner.id);
    await repo.updatePassword(owner.id, passwordHash, { revokedAt: new Date(), verifyEmail: true });
    await repo.revokeAllRefreshTokens(owner.id, 'password_reset');
    await auditAccount(client, ctx, 'auth.password_reset', owner.id);
    return owner;
  });
  if (!user) {
    throw new AppError(422, 'RESET_TOKEN_INVALID', 'Este link de redefinição é inválido ou expirou. Peça um novo.');
  }
  sendEmailLater(passwordChangedMessage(user));
}

/**
 * Troca de senha logado: exige a atual, derruba as outras sessões e devolve um access token novo
 * (o anterior deixa de valer junto com os demais).
 */
export async function changePassword(user, { currentPassword, newPassword, currentRefreshToken }, ctx) {
  const repo = authRepository();
  const current = await repo.findUserById(user.id);
  if (!(await verifyPassword(currentPassword, current?.password_hash))) {
    throw new ValidationError(
      [{ field: 'current_password', code: 'invalid', message: 'Senha atual incorreta.' }],
      'CURRENT_PASSWORD_INVALID',
      'Senha atual incorreta.',
    );
  }
  const passwordHash = await hashPassword(newPassword);

  let keepFamilyId = null;
  if (currentRefreshToken) {
    const token = await repo.findRefreshToken(hashToken(currentRefreshToken));
    if (token && token.user_id === user.id && !token.revoked_at) keepFamilyId = token.family_id;
  }

  await withTransaction(async (client) => {
    const txRepo = authRepository(client);
    await txRepo.updatePassword(user.id, passwordHash, { revokedAt: new Date(), verifyEmail: false });
    await txRepo.revokeAllRefreshTokens(user.id, 'password_changed', { exceptFamilyId: keepFamilyId });
    await auditAccount(client, ctx, 'auth.password_changed', user.id);
  });
  sendEmailLater(passwordChangedMessage(current));
  return { accessToken: signAccessToken(user.id) };
}

export async function verifyEmail({ token }, ctx) {
  const verified = await withTransaction(async (client) => {
    const repo = authRepository(client);
    const verification = await repo.findVerificationTokenForUpdate(hashToken(token));
    if (!verification?.usable) return false;
    const user = await repo.findUserById(verification.user_id);
    // O token confirma um e-mail específico: se a conta mudou de e-mail, ele não vale mais.
    if (!isActive(user) || user.email.toLowerCase() !== verification.email.toLowerCase()) return false;
    await repo.markVerificationTokenUsed(verification.id);
    await repo.markEmailVerified(user.id);
    await auditAccount(client, ctx, 'auth.email_verified', user.id);
    return true;
  });
  if (!verified) {
    throw new AppError(422, 'VERIFICATION_TOKEN_INVALID', 'Este link de confirmação é inválido, expirou ou já foi usado.');
  }
}

export async function resendVerification(user) {
  if (user.email_verified_at) return { alreadyVerified: true };
  const token = await withTransaction((client) => issueVerificationToken(authRepository(client), user));
  sendEmailLater(verifyEmailMessage(user, token));
  return { alreadyVerified: false };
}

/** Quem está logado, de quais empresas participa e se é da equipe ZEVS. */
export async function getMe(user) {
  return {
    user: publicUser(user),
    platform_admin: await isPlatformAdmin(user),
    companies: await listCompaniesForUser(user.id),
  };
}

/** Usuário do access token, recarregado a cada requisição (pág. 04). */
export async function findSessionUser(userId) {
  const user = await authRepository(pool).findUserById(userId);
  return isActive(user) ? user : null;
}

/** Limpeza de tokens vencidos há mais de um dia (job). */
export function deleteExpiredTokens() {
  return authRepository(pool).deleteExpiredTokens();
}
