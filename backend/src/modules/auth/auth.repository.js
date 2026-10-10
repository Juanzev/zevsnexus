// SQL de usuários e tokens de sessão. Única camada com SQL; sempre parametrizado e com projeção
// explícita. Comparações de tempo usam o relógio do banco (now()), num único lugar.
import { pool } from '../../shared/db.js';

const USER_COLUMNS = `id, email, name, password_hash, status, email_verified_at, sessions_revoked_at, created_at`;

/** `db` = pool ou client de uma transação. */
export function authRepository(db = pool) {
  return {
    // ---------- usuários ----------
    async findUserByEmail(email) {
      const { rows } = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findUserById(id) {
      const { rows } = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return rows[0] ?? null;
    },

    async insertUser({ name, email, passwordHash }) {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, terms_accepted_at)
         VALUES ($1, $2, $3, now())
         RETURNING ${USER_COLUMNS}`,
        [name, email, passwordHash],
      );
      return rows[0];
    },

    async updateLastLogin(userId) {
      await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
    },

    /** Troca a senha e invalida access tokens emitidos antes de `revokedAt`. */
    async updatePassword(userId, passwordHash, { revokedAt, verifyEmail }) {
      await db.query(
        `UPDATE users
            SET password_hash = $2,
                password_changed_at = now(),
                sessions_revoked_at = $3,
                email_verified_at = CASE WHEN $4 THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END
          WHERE id = $1`,
        [userId, passwordHash, revokedAt, verifyEmail],
      );
    },

    async setSessionsRevokedAt(userId, revokedAt) {
      await db.query('UPDATE users SET sessions_revoked_at = $2 WHERE id = $1', [userId, revokedAt]);
    },

    async markEmailVerified(userId) {
      await db.query(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
        [userId],
      );
    },

    // ---------- refresh tokens ----------
    /**
     * Cria um refresh token. Família nova quando `familyExpiresAt` é nulo (teto a partir de agora);
     * na rotação, herda o teto da família. A validade nunca passa do teto.
     */
    async insertRefreshToken({ userId, familyId, tokenHash, ttlSeconds, familyMaxAgeSeconds, familyExpiresAt, ip, userAgent }) {
      const { rows } = await db.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, family_expires_at, expires_at, ip, user_agent)
         SELECT $1, $2, $3, f.family_expires_at,
                LEAST(now() + make_interval(secs => $4), f.family_expires_at), $6, $7
           FROM (SELECT COALESCE($5::timestamptz, now() + make_interval(secs => $8)) AS family_expires_at) AS f
         RETURNING id, expires_at, family_expires_at`,
        [userId, familyId, tokenHash, ttlSeconds, familyExpiresAt ?? null, ip ?? null, userAgent?.slice(0, 255) ?? null, familyMaxAgeSeconds],
      );
      return rows[0];
    },

    /** Trava o token para rotação e já calcula expiração e janela de tolerância no relógio do banco. */
    async findRefreshTokenForUpdate(tokenHash, graceSeconds) {
      const { rows } = await db.query(
        `SELECT id, user_id, family_id, replaced_by_id, revoked_at, family_expires_at,
                expires_at <= now() AS expired,
                family_expires_at <= now() AS family_expired,
                rotated_at > now() - make_interval(secs => $2) AS within_grace
           FROM refresh_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash, graceSeconds],
      );
      return rows[0] ?? null;
    },

    async findRefreshToken(tokenHash) {
      const { rows } = await db.query(
        'SELECT id, user_id, family_id, revoked_at FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash],
      );
      return rows[0] ?? null;
    },

    async markRotated(tokenId, replacedById) {
      await db.query(
        'UPDATE refresh_tokens SET replaced_by_id = $2, rotated_at = now() WHERE id = $1',
        [tokenId, replacedById],
      );
    },

    async revokeFamily(familyId, reason) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId, reason],
      );
    },

    async revokeAllRefreshTokens(userId, reason, { exceptFamilyId = null } = {}) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
          WHERE user_id = $1 AND revoked_at IS NULL
            AND ($3::uuid IS NULL OR family_id <> $3::uuid)`,
        [userId, reason, exceptFamilyId],
      );
    },

    // ---------- reset de senha ----------
    async invalidateResetTokens(userId) {
      await db.query(
        `UPDATE password_reset_tokens SET invalidated_at = now()
          WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
        [userId],
      );
    },

    async insertResetToken({ userId, tokenHash, ttlSeconds, ip }) {
      await db.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
         VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
        [userId, tokenHash, ttlSeconds, ip ?? null],
      );
    },

    async findResetTokenForUpdate(tokenHash) {
      const { rows } = await db.query(
        `SELECT id, user_id,
                (used_at IS NULL AND invalidated_at IS NULL AND expires_at > now()) AS usable
           FROM password_reset_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash],
      );
      return rows[0] ?? null;
    },

    async markResetTokenUsed(tokenId) {
      await db.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [tokenId]);
    },

    // ---------- verificação de e-mail ----------
    async invalidateVerificationTokens(userId) {
      await db.query(
        `UPDATE email_verification_tokens SET invalidated_at = now()
          WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
        [userId],
      );
    },

    async insertVerificationToken({ userId, email, tokenHash, ttlSeconds }) {
      await db.query(
        `INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
        [userId, email, tokenHash, ttlSeconds],
      );
    },

    async findVerificationTokenForUpdate(tokenHash) {
      const { rows } = await db.query(
        `SELECT id, user_id, email,
                (used_at IS NULL AND invalidated_at IS NULL AND expires_at > now()) AS usable
           FROM email_verification_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash],
      );
      return rows[0] ?? null;
    },

    async markVerificationTokenUsed(tokenId) {
      await db.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [tokenId]);
    },

    // ---------- limpeza (job) ----------
    /** Apaga tokens vencidos há mais de um dia. Devolve quantos de cada tipo. */
    async deleteExpiredTokens() {
      const refresh = await db.query(
        "DELETE FROM refresh_tokens WHERE family_expires_at < now() - interval '1 day'",
      );
      const reset = await db.query(
        "DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'",
      );
      const verification = await db.query(
        "DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '1 day'",
      );
      return { refresh: refresh.rowCount, reset: reset.rowCount, verification: verification.rowCount };
    },
  };
}
