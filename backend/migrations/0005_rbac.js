// RBAC (pág. 05): catálogo em código + seed idempotente. Papéis e permissões são da plataforma;
// o que é por empresa é o vínculo (membership_roles) e os grants/denies por membro.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE permissions (
      code text PRIMARY KEY CHECK (code ~ '^[a-z_]+\\.[a-z_]+$'),
      description text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE roles (
      code text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
      name text NOT NULL,
      description text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE role_permissions (
      role_code text NOT NULL REFERENCES roles (code) ON DELETE CASCADE,
      permission_code text NOT NULL REFERENCES permissions (code) ON DELETE CASCADE,
      PRIMARY KEY (role_code, permission_code)
    );

    CREATE TABLE membership_roles (
      company_id uuid NOT NULL,
      membership_id uuid NOT NULL,
      role_code text NOT NULL REFERENCES roles (code),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (membership_id, role_code),
      FOREIGN KEY (company_id, membership_id) REFERENCES memberships (company_id, id) ON DELETE CASCADE
    );
    CREATE INDEX membership_roles_company_idx ON membership_roles (company_id, role_code);

    CREATE TABLE membership_permissions (
      company_id uuid NOT NULL,
      membership_id uuid NOT NULL,
      permission_code text NOT NULL REFERENCES permissions (code),
      effect text NOT NULL CHECK (effect IN ('grant', 'deny')),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (membership_id, permission_code),
      FOREIGN KEY (company_id, membership_id) REFERENCES memberships (company_id, id) ON DELETE CASCADE
    );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS membership_permissions;
    DROP TABLE IF EXISTS membership_roles;
    DROP TABLE IF EXISTS role_permissions;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS permissions;
  `);
};
