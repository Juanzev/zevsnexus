// Idempotency-Key (pág. 08): mesma chave + mesmo corpo devolve a resposta salva; corpo diferente
// → 422; ainda processando → 409; erro não consome a chave. Vale 24 h.
// O escopo inclui a empresa e o caminho real (mesma chave em outra operação = outra operação).

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE idempotency_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      company_id uuid REFERENCES companies (id) ON DELETE CASCADE,
      scope text NOT NULL CHECK (char_length(scope) <= 300),
      key text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),
      request_hash text NOT NULL CHECK (char_length(request_hash) = 64),
      status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
      response_status integer,
      response_body jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
      UNIQUE (user_id, scope, key)
    );
    CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS idempotency_keys;');
};
