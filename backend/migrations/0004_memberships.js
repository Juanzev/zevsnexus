// Vínculo usuário × empresa (pág. 04): o usuário é global, o acesso é por membership.
// Convites (invitations) entram com a equipe, na F10.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (company_id, id)
    );
    CREATE UNIQUE INDEX memberships_company_user_active_key ON memberships (company_id, user_id) WHERE deleted_at IS NULL;
    CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE deleted_at IS NULL;
    CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON memberships
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS memberships;');
};
