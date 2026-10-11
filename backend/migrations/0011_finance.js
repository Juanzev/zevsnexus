// Financeiro administrativo (FASE-0 D4, ARCHITECTURE §12 e §12.1): despesa = obrigação;
// pagamento = baixa efetiva (1..N, parcial permitido). Dinheiro em centavos bigint, datas `date` no
// fuso da empresa. "Vencida" é calculada, nunca gravada. Pagamento não se edita: estorna e lança outro.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE finance_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('expense', 'income')),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
      sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
      archived_at timestamptz,
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, id)
    );
    CREATE UNIQUE INDEX finance_categories_name_key ON finance_categories (company_id, kind, lower(name))
      WHERE archived_at IS NULL;
    CREATE TRIGGER finance_categories_set_updated_at BEFORE UPDATE ON finance_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE expenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
      party_id uuid,
      category_id uuid,
      amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
      -- Só muda pela função única (expensesRepository.settle), com UPDATE atômico condicional.
      paid_amount_cents bigint NOT NULL DEFAULT 0,
      due_date date NOT NULL,
      scheduled_for date,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'scheduled', 'partially_paid', 'paid', 'cancelled')),
      cancelled_at timestamptz,
      cancelled_by uuid REFERENCES users (id),
      cancel_reason text CHECK (char_length(cancel_reason) BETWEEN 1 AND 500),
      notes text CHECK (char_length(notes) <= 2000),
      search_text text GENERATED ALWAYS AS (f_unaccent(lower(description || ' ' || COALESCE(notes, '')))) STORED,
      version integer NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, id),
      FOREIGN KEY (company_id, party_id) REFERENCES parties (company_id, id),
      FOREIGN KEY (company_id, category_id) REFERENCES finance_categories (company_id, id),
      -- O status sempre conversa com os valores (a expressão única do backend garante; o banco confere).
      CHECK (paid_amount_cents BETWEEN 0 AND amount_cents),
      CHECK (status <> 'paid' OR paid_amount_cents = amount_cents),
      CHECK (status <> 'partially_paid' OR paid_amount_cents BETWEEN 1 AND amount_cents - 1),
      CHECK (status NOT IN ('pending', 'scheduled') OR paid_amount_cents = 0),
      CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL),
      CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
      CHECK (status <> 'cancelled' OR (paid_amount_cents = 0 AND cancel_reason IS NOT NULL AND cancelled_by IS NOT NULL))
    );
    CREATE INDEX expenses_status_due_idx ON expenses (company_id, status, due_date);
    CREATE INDEX expenses_due_idx ON expenses (company_id, due_date);
    CREATE INDEX expenses_party_idx ON expenses (company_id, party_id, due_date DESC);
    CREATE INDEX expenses_category_idx ON expenses (company_id, category_id);
    CREATE INDEX expenses_search_idx ON expenses USING gin (search_text gin_trgm_ops);
    CREATE TRIGGER expenses_set_updated_at BEFORE UPDATE ON expenses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE expense_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      expense_id uuid NOT NULL,
      paid_on date NOT NULL,
      amount_cents bigint NOT NULL CHECK (amount_cents > 0),
      method text NOT NULL CHECK (method IN ('pix', 'boleto', 'transfer', 'cash', 'card', 'check', 'other')),
      reference text CHECK (char_length(reference) <= 120),
      notes text CHECK (char_length(notes) <= 500),
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      voided_at timestamptz,
      voided_by uuid REFERENCES users (id),
      void_reason text CHECK (char_length(void_reason) BETWEEN 1 AND 500),
      CHECK ((voided_at IS NULL) = (void_reason IS NULL) AND (voided_at IS NULL) = (voided_by IS NULL)),
      UNIQUE (company_id, id),
      UNIQUE (company_id, expense_id, id),
      FOREIGN KEY (company_id, expense_id) REFERENCES expenses (company_id, id)
    );
    CREATE INDEX expense_payments_expense_idx ON expense_payments (company_id, expense_id, paid_on);
    CREATE INDEX expense_payments_paid_on_idx ON expense_payments (company_id, paid_on) WHERE voided_at IS NULL;

    -- Pagamento é fato: nunca se apaga nem se edita. A única mudança permitida é marcar o estorno, uma vez.
    CREATE FUNCTION expense_payments_guard() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'pagamento não se apaga: registre o estorno' USING ERRCODE = 'restrict_violation';
        END IF;
        IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
           OR (NEW.id, NEW.company_id, NEW.expense_id, NEW.paid_on, NEW.amount_cents, NEW.method,
               NEW.reference, NEW.notes, NEW.created_by, NEW.created_at)
              IS DISTINCT FROM
              (OLD.id, OLD.company_id, OLD.expense_id, OLD.paid_on, OLD.amount_cents, OLD.method,
               OLD.reference, OLD.notes, OLD.created_by, OLD.created_at) THEN
          RAISE EXCEPTION 'pagamento não se edita: só o estorno, uma vez' USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
      END;
      $$;
    CREATE TRIGGER expense_payments_guard BEFORE UPDATE OR DELETE ON expense_payments
      FOR EACH ROW EXECUTE FUNCTION expense_payments_guard();
    CREATE TRIGGER expense_payments_no_truncate BEFORE TRUNCATE ON expense_payments
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

    -- Comprovantes e anexos: o arquivo é um documento da Central; aqui só o vínculo e o papel.
    CREATE TABLE expense_documents (
      company_id uuid NOT NULL,
      expense_id uuid NOT NULL,
      document_id uuid NOT NULL,
      payment_id uuid,
      role text NOT NULL CHECK (role IN ('receipt', 'invoice', 'boleto', 'contract', 'other')),
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, expense_id, document_id),
      FOREIGN KEY (company_id, expense_id) REFERENCES expenses (company_id, id),
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id),
      -- O pagamento do comprovante é da mesma despesa (FK composta; nulo = anexo da despesa).
      FOREIGN KEY (company_id, expense_id, payment_id) REFERENCES expense_payments (company_id, expense_id, id)
    );
    CREATE INDEX expense_documents_document_idx ON expense_documents (company_id, document_id);

    -- Tags em despesas (D11): as mesmas tags da empresa usadas nos documentos.
    CREATE TABLE expense_tags (
      company_id uuid NOT NULL,
      expense_id uuid NOT NULL,
      tag_id uuid NOT NULL,
      PRIMARY KEY (company_id, expense_id, tag_id),
      FOREIGN KEY (company_id, expense_id) REFERENCES expenses (company_id, id) ON DELETE CASCADE,
      FOREIGN KEY (company_id, tag_id) REFERENCES tags (company_id, id) ON DELETE CASCADE
    );
    CREATE INDEX expense_tags_tag_idx ON expense_tags (company_id, tag_id);

    -- Janela da aba "Próximas" (dias a partir de hoje, no fuso da empresa).
    ALTER TABLE company_settings ADD COLUMN upcoming_window_days integer NOT NULL DEFAULT 7
      CHECK (upcoming_window_days BETWEEN 1 AND 60);

    -- Empresas já existentes recebem as categorias sugeridas (dados editáveis; ARCHITECTURE §12).
    INSERT INTO finance_categories (company_id, kind, name, sort_order)
    SELECT c.id, 'expense', d.name, d.position * 10
      FROM companies c
     CROSS JOIN unnest(ARRAY[
       'Mão de obra', 'Materiais', 'Serviços de terceiros', 'Impostos e taxas', 'Aluguel', 'Contas de consumo',
       'Folha e pró-labore', 'Equipamentos e ferramentas', 'Transporte e combustível', 'Tarifas bancárias', 'Outros'
     ]) WITH ORDINALITY AS d(name, position)
     WHERE NOT EXISTS (SELECT 1 FROM finance_categories fc WHERE fc.company_id = c.id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE company_settings DROP COLUMN IF EXISTS upcoming_window_days;
    DROP TABLE IF EXISTS expense_tags;
    DROP TABLE IF EXISTS expense_documents;
    DROP TABLE IF EXISTS expense_payments;
    DROP FUNCTION IF EXISTS expense_payments_guard();
    DROP TABLE IF EXISTS expenses;
    DROP TABLE IF EXISTS finance_categories;
  `);
};
