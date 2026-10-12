// Notas fiscais (FASE-0 D7, ARCHITECTURE §14 e §14.1): só as emitidas pela empresa no MVP. Três
// dimensões separadas — ciclo (status), recebimento (payment_status) e arquivamento — amarradas por
// CHECKs. PDF, XML e comprovante são documentos da Central, ligados por invoice_documents.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE invoices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      direction text NOT NULL DEFAULT 'issued' CHECK (direction IN ('issued', 'received')),
      kind text NOT NULL DEFAULT 'nfse' CHECK (kind IN ('nfse', 'nfe', 'other')),
      number text CHECK (char_length(number) BETWEEN 1 AND 30),
      series text CHECK (char_length(series) BETWEEN 1 AND 10),
      issue_date date,
      -- Mês de competência, gravado como o dia 1.
      competence date CHECK (extract(day FROM competence) = 1),
      party_id uuid,
      description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
      gross_amount_cents bigint NOT NULL CHECK (gross_amount_cents BETWEEN 1 AND 99999999999999),
      withheld_cents bigint NOT NULL DEFAULT 0,
      net_amount_cents bigint GENERATED ALWAYS AS (gross_amount_cents - withheld_cents) STORED,
      due_date date,
      verification_code text CHECK (char_length(verification_code) BETWEEN 1 AND 100),
      notes text CHECK (char_length(notes) <= 2000),
      status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'issued', 'cancelled')),
      cancelled_at timestamptz,
      cancelled_by uuid REFERENCES users (id),
      cancel_reason text CHECK (char_length(cancel_reason) BETWEEN 1 AND 500),
      payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
      received_on date,
      received_amount_cents bigint CHECK (received_amount_cents BETWEEN 1 AND 99999999999999),
      -- Último "desfazer pagamento": o motivo fica aqui (texto livre não vai para a auditoria).
      payment_undone_at timestamptz,
      payment_undone_by uuid REFERENCES users (id),
      payment_undo_reason text CHECK (char_length(payment_undo_reason) BETWEEN 1 AND 500),
      archived_at timestamptz,
      search_text text GENERATED ALWAYS AS
        (f_unaccent(lower(COALESCE(number, '') || ' ' || description || ' ' || COALESCE(notes, '')))) STORED,
      version integer NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, id),
      FOREIGN KEY (company_id, party_id) REFERENCES parties (company_id, id),
      CHECK (withheld_cents BETWEEN 0 AND gross_amount_cents),
      -- Emitida exige número e data (vale também depois de cancelada, se chegou a ser emitida).
      CHECK (status <> 'issued' OR (number IS NOT NULL AND issue_date IS NOT NULL)),
      CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
      CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND cancelled_by IS NOT NULL)),
      -- Paga ⇔ recebimento preenchido; e só nota emitida pode estar paga (cancelada nunca).
      CHECK ((payment_status = 'paid') = (received_on IS NOT NULL AND received_amount_cents IS NOT NULL)),
      CHECK (payment_status <> 'paid' OR status = 'issued'),
      CHECK ((payment_undone_at IS NULL) = (payment_undo_reason IS NULL) AND (payment_undone_at IS NULL) = (payment_undone_by IS NULL))
    );
    -- Número único por empresa, tipo, série e número (D7). A cancelada continua ocupando o número.
    CREATE UNIQUE INDEX invoices_number_key ON invoices (company_id, kind, COALESCE(series, ''), number)
      WHERE number IS NOT NULL AND direction = 'issued';
    CREATE INDEX invoices_tab_idx ON invoices (company_id, status, payment_status, issue_date DESC);
    CREATE INDEX invoices_party_idx ON invoices (company_id, party_id, issue_date DESC);
    CREATE INDEX invoices_due_idx ON invoices (company_id, due_date) WHERE status = 'issued' AND payment_status = 'pending';
    CREATE INDEX invoices_search_idx ON invoices USING gin (search_text gin_trgm_ops);
    CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- PDF, XML, comprovante: o arquivo é um documento da Central; aqui só o vínculo e o papel.
    CREATE TABLE invoice_documents (
      company_id uuid NOT NULL,
      invoice_id uuid NOT NULL,
      document_id uuid NOT NULL,
      role text NOT NULL CHECK (role IN ('pdf', 'xml', 'receipt', 'other')),
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, invoice_id, document_id),
      FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id),
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id)
    );
    CREATE INDEX invoice_documents_document_idx ON invoice_documents (company_id, document_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS invoice_documents;
    DROP TABLE IF EXISTS invoices;
  `);
};
