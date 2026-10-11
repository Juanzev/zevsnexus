// Prestadores e fornecedores (ARCHITECTURE §12 e §12.1): uma tabela para fornecedor, prestador e
// cliente (`roles`). "Pedreiro" é dado (`specialty`), nunca módulo. Pessoa física é titular de dados (LGPD).

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE parties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      person_type text NOT NULL CHECK (person_type IN ('individual', 'company')),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
      trade_name text CHECK (char_length(trade_name) <= 160),
      -- CPF (11 dígitos) ou CNPJ (14, alfanumérico), validados no backend e guardados sem máscara.
      document_normalized text,
      roles text[] NOT NULL CHECK (
        cardinality(roles) BETWEEN 1 AND 3 AND roles <@ ARRAY['supplier', 'service_provider', 'customer']::text[]
      ),
      specialty text CHECK (char_length(specialty) <= 80),
      email citext CHECK (char_length(email) <= 254),
      phone text CHECK (phone ~ '^[0-9]{10,11}$'),
      pix_key text CHECK (char_length(pix_key) <= 140),
      notes text CHECK (char_length(notes) <= 2000),
      search_text text GENERATED ALWAYS AS (
        f_unaccent(lower(name || ' ' || COALESCE(trade_name, '') || ' ' || COALESCE(specialty, '')))
      ) STORED,
      version integer NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (company_id, id),
      CHECK (
        document_normalized IS NULL
        OR (person_type = 'individual' AND document_normalized ~ '^[0-9]{11}$')
        OR (person_type = 'company' AND document_normalized ~ '^[0-9A-Z]{12}[0-9]{2}$')
      )
    );
    CREATE UNIQUE INDEX parties_document_key ON parties (company_id, document_normalized)
      WHERE deleted_at IS NULL AND document_normalized IS NOT NULL;
    CREATE INDEX parties_name_idx ON parties (company_id, lower(name)) WHERE deleted_at IS NULL;
    CREATE INDEX parties_search_idx ON parties USING gin (search_text gin_trgm_ops);
    CREATE TRIGGER parties_set_updated_at BEFORE UPDATE ON parties
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Documentos da ficha do prestador (contrato, RG, certidões): vínculo, nunca cópia do arquivo.
    CREATE TABLE party_documents (
      company_id uuid NOT NULL,
      party_id uuid NOT NULL,
      document_id uuid NOT NULL,
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, party_id, document_id),
      FOREIGN KEY (company_id, party_id) REFERENCES parties (company_id, id) ON DELETE CASCADE,
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id) ON DELETE CASCADE
    );
    CREATE INDEX party_documents_document_idx ON party_documents (company_id, document_id);

    -- Pasta padrão dos documentos de prestadores (nova empresa: a pasta sugerida "Prestadores").
    ALTER TABLE company_settings ADD COLUMN parties_folder_id uuid;
    ALTER TABLE company_settings ADD CONSTRAINT company_settings_parties_folder_fkey
      FOREIGN KEY (company_id, parties_folder_id) REFERENCES folders (company_id, id);
    -- Empresas criadas na F3 já têm a pasta sugerida na raiz: passa a ser a padrão.
    UPDATE company_settings cs SET parties_folder_id = f.id
      FROM folders f
     WHERE f.company_id = cs.company_id AND f.parent_id IS NULL AND f.deleted_at IS NULL AND f.name = 'Prestadores';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_parties_folder_fkey;
    ALTER TABLE company_settings DROP COLUMN IF EXISTS parties_folder_id;
    DROP TABLE IF EXISTS party_documents;
    DROP TABLE IF EXISTS parties;
  `);
};
