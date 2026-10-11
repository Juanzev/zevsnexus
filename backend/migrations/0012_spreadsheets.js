// Planilhas (FASE-0 D6, ARCHITECTURE §13.1 e §13.1.1): extensão 1:1 de `documents` para os documentos
// cuja versão é planilha (xlsx, xls, csv, ods). As visões (em uso, ano) são filtros, não pastas.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE spreadsheets (
      company_id uuid NOT NULL,
      document_id uuid NOT NULL,
      in_use boolean NOT NULL DEFAULT false,
      reference_year smallint NOT NULL CHECK (reference_year BETWEEN 1990 AND 2100),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES users (id),
      PRIMARY KEY (company_id, document_id),
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id) ON DELETE CASCADE
    );
    CREATE INDEX spreadsheets_view_idx ON spreadsheets (company_id, in_use, reference_year);
    CREATE TRIGGER spreadsheets_set_updated_at BEFORE UPDATE ON spreadsheets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Planilhas já guardadas na Central: ano = ano do envio, no fuso da empresa.
    INSERT INTO spreadsheets (company_id, document_id, reference_year)
    SELECT d.company_id, d.id, LEAST(GREATEST(extract(year FROM d.created_at AT TIME ZONE c.timezone)::int, 1990), 2100)
      FROM documents d
      JOIN companies c ON c.id = d.company_id
      JOIN LATERAL (SELECT v.file_id FROM document_versions v
                     WHERE v.company_id = d.company_id AND v.document_id = d.id
                     ORDER BY v.version_number DESC LIMIT 1) cv ON true
      JOIN files f ON f.company_id = d.company_id AND f.id = cv.file_id
     WHERE f.extension IN ('xlsx', 'xls', 'csv', 'ods')
    ON CONFLICT DO NOTHING;
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS spreadsheets;');
};
