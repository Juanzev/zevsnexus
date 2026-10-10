// Identidade e sessão (pág. 04). Usuário é global: o vínculo com cada empresa é a membership (F2).
// Tokens opacos (refresh, reset, verificação) guardados só como hash SHA-256 (hex).

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email citext NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      password_hash text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      email_verified_at timestamptz,
      terms_accepted_at timestamptz NOT NULL,
      password_changed_at timestamptz,
      -- Access tokens emitidos antes deste instante são recusados (logout geral, reset de senha).
      sessions_revoked_at timestamptz,
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE UNIQUE INDEX users_email_active_key ON users (email) WHERE deleted_at IS NULL;
    CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      family_id uuid NOT NULL,
      token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
      expires_at timestamptz NOT NULL,
      family_expires_at timestamptz NOT NULL,
      replaced_by_id uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
      rotated_at timestamptz,
      revoked_at timestamptz,
      revoked_reason text CHECK (revoked_reason IN ('logout', 'logout_all', 'reuse', 'password_reset', 'password_changed')),
      ip text,
      user_agent text CHECK (char_length(user_agent) <= 255),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (expires_at <= family_expires_at)
    );
    CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
    CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
    CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (family_expires_at);

    CREATE TABLE password_reset_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      -- Só o token mais recente vale: os anteriores são invalidados ao emitir um novo.
      invalidated_at timestamptz,
      requested_ip text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

    CREATE TABLE email_verification_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- E-mail que o token confirma: se o e-mail da conta mudar, o token deixa de valer.
      email citext NOT NULL,
      token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      invalidated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens (user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS email_verification_tokens;
    DROP TABLE IF EXISTS password_reset_tokens;
    DROP TABLE IF EXISTS refresh_tokens;
    DROP TABLE IF EXISTS users;
  `);
};
