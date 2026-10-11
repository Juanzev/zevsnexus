// Central de Documentos (ARCHITECTURE §10–§11): "um arquivo, um lugar".
// files = binário no storage; documents = arquivo lógico; document_versions liga os dois.
// Toda relação interna usa FK composta (company_id, x_id) — ADR-005.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      -- companies/<company_id>/files/<id>: gerada só pelo servidor, sem nome de arquivo.
      storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^companies/[0-9a-f-]{36}/files/[0-9a-f-]{36}$'),
      original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 200),
      extension text NOT NULL CHECK (extension ~ '^[a-z0-9]{1,8}$'),
      content_type text NOT NULL CHECK (char_length(content_type) <= 120),
      size_bytes bigint NOT NULL CHECK (size_bytes > 0),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'rejected')),
      expires_at timestamptz NOT NULL,
      uploaded_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz,
      -- O navegador envia para companies/<id>/uploads/<id>; na confirmação o servidor copia para a chave
      -- definitiva. A chave de upload é apagada de novo depois que a URL de PUT expira (job).
      upload_purged_at timestamptz,
      UNIQUE (company_id, id)
    );
    CREATE INDEX files_pending_expiry_idx ON files (expires_at) WHERE status = 'pending';
    CREATE INDEX files_upload_purge_idx ON files (created_at) WHERE status = 'ready' AND upload_purged_at IS NULL;

    CREATE TABLE folders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      parent_id uuid,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name !~ '[/\\\\]'),
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (company_id, id),
      FOREIGN KEY (company_id, parent_id) REFERENCES folders (company_id, id),
      CHECK (parent_id IS NULL OR parent_id <> id)
    );
    -- Nome único entre irmãs (raiz incluída), sem diferenciar maiúsculas.
    CREATE UNIQUE INDEX folders_sibling_name_key ON folders
      (company_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
      WHERE deleted_at IS NULL;
    CREATE INDEX folders_parent_idx ON folders (company_id, parent_id) WHERE deleted_at IS NULL;
    CREATE TRIGGER folders_set_updated_at BEFORE UPDATE ON folders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE document_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
      archived_at timestamptz,
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, id)
    );
    CREATE UNIQUE INDEX document_types_name_key ON document_types (company_id, lower(name)) WHERE archived_at IS NULL;

    CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      folder_id uuid,
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      description text CHECK (char_length(description) <= 2000),
      document_type_id uuid,
      expires_on date,
      archived_at timestamptz,
      search_text text GENERATED ALWAYS AS (f_unaccent(lower(title || ' ' || COALESCE(description, '')))) STORED,
      version integer NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (company_id, id),
      FOREIGN KEY (company_id, folder_id) REFERENCES folders (company_id, id),
      FOREIGN KEY (company_id, document_type_id) REFERENCES document_types (company_id, id)
    );
    CREATE INDEX documents_folder_idx ON documents (company_id, folder_id, updated_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX documents_updated_idx ON documents (company_id, updated_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX documents_expires_idx ON documents (company_id, expires_on) WHERE deleted_at IS NULL AND expires_on IS NOT NULL;
    CREATE INDEX documents_search_idx ON documents USING gin (search_text gin_trgm_ops);
    CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE document_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      document_id uuid NOT NULL,
      version_number integer NOT NULL CHECK (version_number > 0),
      file_id uuid NOT NULL,
      comment text CHECK (char_length(comment) <= 500),
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, document_id, version_number),
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id),
      FOREIGN KEY (company_id, file_id) REFERENCES files (company_id, id)
    );
    CREATE INDEX document_versions_file_idx ON document_versions (company_id, file_id);

    CREATE TABLE tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, id)
    );
    CREATE UNIQUE INDEX tags_name_key ON tags (company_id, lower(name));

    CREATE TABLE document_tags (
      company_id uuid NOT NULL,
      document_id uuid NOT NULL,
      tag_id uuid NOT NULL,
      PRIMARY KEY (document_id, tag_id),
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id) ON DELETE CASCADE,
      FOREIGN KEY (company_id, tag_id) REFERENCES tags (company_id, id) ON DELETE CASCADE
    );
    CREATE INDEX document_tags_tag_idx ON document_tags (company_id, tag_id);

    CREATE TABLE document_favorites (
      company_id uuid NOT NULL,
      membership_id uuid NOT NULL,
      document_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (membership_id, document_id),
      FOREIGN KEY (company_id, membership_id) REFERENCES memberships (company_id, id) ON DELETE CASCADE,
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id) ON DELETE CASCADE
    );

    -- Configurações da empresa: nasce com as pastas padrão; cada coluna nova entra com o módulo que a usa.
    CREATE TABLE company_settings (
      company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
      company_folder_id uuid,
      receipts_folder_id uuid,
      invoices_folder_id uuid,
      spreadsheets_folder_id uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (company_id, company_folder_id) REFERENCES folders (company_id, id),
      FOREIGN KEY (company_id, receipts_folder_id) REFERENCES folders (company_id, id),
      FOREIGN KEY (company_id, invoices_folder_id) REFERENCES folders (company_id, id),
      FOREIGN KEY (company_id, spreadsheets_folder_id) REFERENCES folders (company_id, id)
    );
    CREATE TRIGGER company_settings_set_updated_at BEFORE UPDATE ON company_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Empresas criadas antes desta migration: só a linha de configurações (sem pastas sugeridas).
    INSERT INTO company_settings (company_id) SELECT id FROM companies ON CONFLICT DO NOTHING;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS company_settings;
    DROP TABLE IF EXISTS document_favorites;
    DROP TABLE IF EXISTS document_tags;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS document_versions;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS document_types;
    DROP TABLE IF EXISTS folders;
    DROP TABLE IF EXISTS files;
  `);
};
