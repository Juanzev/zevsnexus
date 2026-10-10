// Auditoria append-only (pág. 06 §11 e pág. 07): gravada na mesma transação da mudança;
// UPDATE, DELETE e TRUNCATE são bloqueados por trigger. company_id é nulo em eventos só do
// usuário (login, troca de senha). Dado pessoal nunca entra no metadata: vira "[dado pessoal]".

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid REFERENCES companies (id),
      actor_type text NOT NULL CHECK (actor_type IN ('user', 'platform_admin', 'system')),
      actor_user_id uuid REFERENCES users (id),
      action text NOT NULL CHECK (action ~ '^[a-z_]+\\.[a-z_]+$'),
      entity_type text CHECK (entity_type ~ '^[a-z_]+$'),
      entity_id uuid,
      request_id text CHECK (char_length(request_id) <= 128),
      ip text CHECK (char_length(ip) <= 64),
      user_agent text CHECK (char_length(user_agent) <= 255),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_logs_company_created_idx ON audit_logs (company_id, created_at DESC);
    CREATE INDEX audit_logs_entity_idx ON audit_logs (company_id, entity_type, entity_id);
    CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, action, created_at DESC);
    -- Contagem recente por entidade e ação (ex.: teto de e-mails por destinatário).
    CREATE INDEX audit_logs_entity_action_idx ON audit_logs (entity_id, action, created_at DESC);

    CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
    CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS audit_logs;');
};
