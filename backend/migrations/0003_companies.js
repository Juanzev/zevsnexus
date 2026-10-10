// Empresa = tenant (pág. 03, ADR-002). Tabelas filhas da empresa usam FK composta (ADR-005):
// por isso as tabelas que outras referenciam têm UNIQUE (company_id, id).
// company_settings nasce na 0009 (F3), quando tiver colunas; invitations, na F10.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE companies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      legal_name text NOT NULL CHECK (char_length(legal_name) BETWEEN 2 AND 200),
      trade_name text CHECK (char_length(trade_name) BETWEEN 1 AND 200),
      -- CNPJ normalizado (14 caracteres; os 12 primeiros podem ser alfanuméricos desde jul/2026).
      -- Não é único na plataforma: unicidade revelaria a outro tenant que o CNPJ já existe.
      cnpj text CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
      timezone text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (char_length(timezone) BETWEEN 3 AND 64),
      state_registration text CHECK (char_length(state_registration) <= 30),
      municipal_registration text CHECK (char_length(municipal_registration) <= 30),
      tax_regime text CHECK (tax_regime IN ('mei', 'simples', 'presumido', 'real', 'other')),
      email citext CHECK (char_length(email) <= 254),
      phone text CHECK (phone ~ '^[0-9]{10,11}$'),
      address_cep text CHECK (address_cep ~ '^[0-9]{8}$'),
      address_street text CHECK (char_length(address_street) <= 200),
      address_number text CHECK (char_length(address_number) <= 20),
      address_complement text CHECK (char_length(address_complement) <= 100),
      address_district text CHECK (char_length(address_district) <= 100),
      address_city text CHECK (char_length(address_city) <= 100),
      address_state text CHECK (address_state ~ '^[A-Z]{2}$'),
      approved_at timestamptz,
      approved_by uuid REFERENCES users (id),
      suspended_at timestamptz,
      suspended_reason text CHECK (char_length(suspended_reason) <= 500),
      version integer NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE INDEX companies_status_idx ON companies (status, created_at DESC) WHERE deleted_at IS NULL;
    CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON companies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE company_branding (
      company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
      primary_color text NOT NULL DEFAULT '#1d4ed8' CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
      updated_by uuid REFERENCES users (id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TRIGGER company_branding_set_updated_at BEFORE UPDATE ON company_branding
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE company_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      role_title text CHECK (char_length(role_title) <= 80),
      email citext CHECK (char_length(email) <= 254),
      phone text CHECK (phone ~ '^[0-9]{10,11}$'),
      is_responsible boolean NOT NULL DEFAULT false,
      notes text CHECK (char_length(notes) <= 1000),
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (company_id, id)
    );
    CREATE INDEX company_contacts_company_idx ON company_contacts (company_id, name) WHERE deleted_at IS NULL;
    CREATE TRIGGER company_contacts_set_updated_at BEFORE UPDATE ON company_contacts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Uso consumido (cota do plano). Só muda pela função única, com UPDATE atômico (pág. 07).
    CREATE TABLE company_usage (
      company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
      storage_bytes bigint NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
      file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS company_usage;
    DROP TABLE IF EXISTS company_contacts;
    DROP TABLE IF EXISTS company_branding;
    DROP TABLE IF EXISTS companies;
  `);
};
